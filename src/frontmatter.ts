import {
  type EditorState,
  type Extension,
  Facet,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";
import { frontMatterEnd } from "./markdown/parser.ts";

const setFolded = StateEffect.define<boolean>();

/**
 * Reasons to keep the front matter open whatever the fold says, such as a change inside it that
 * is waiting to be reviewed.
 */
export const keepFrontMatterOpen =
  Facet.define<(state: EditorState) => boolean>();

/** Whether the front matter is set to be folded away. */
export const frontMatterFolded = StateField.define<boolean>({
  create: () => true,
  update(folded, tr) {
    for (const effect of tr.effects)
      if (effect.is(setFolded)) folded = effect.value;
    if (!folded) return false;
    const end = frontMatterEnd(tr.startState.doc);
    if (!end) return folded;
    // An edit inside the fold, or a cursor put there, opens it: text is never changed unseen.
    let touched = false;
    tr.changes.iterChangedRanges((from) => {
      if (from <= end) touched = true;
    });
    const head = tr.state.selection.main.head;
    if (tr.selection && head > 0 && head < frontMatterEnd(tr.state.doc))
      touched = true;
    return !touched;
  },
});

/** The folded range, or null when there is no front matter or it is open. */
export function foldedFrontMatter(
  state: EditorState,
): { from: number; to: number } | null {
  if (!state.field(frontMatterFolded, false)) return null;
  if (state.facet(keepFrontMatterOpen).some((keep) => keep(state))) return null;
  const to = frontMatterEnd(state.doc);
  return to ? { from: 0, to } : null;
}

class FoldWidget extends WidgetType {
  constructor(readonly lines: number) {
    super();
  }

  override eq(other: FoldWidget) {
    return this.lines === other.lines;
  }

  override toDOM(view: EditorView) {
    const dom = view.dom.ownerDocument.createElement("span");
    dom.className = "sg-fold";
    dom.textContent = `front matter, lines 1–${this.lines}`;
    dom.title = "Show the front matter";
    dom.setAttribute("role", "button");
    dom.addEventListener("mousedown", (event) => {
      event.preventDefault();
      view.dispatch({ effects: setFolded.of(false) });
    });
    return dom;
  }

  override ignoreEvent() {
    return true;
  }
}

class FoldButton extends WidgetType {
  override eq() {
    return true;
  }

  override toDOM(view: EditorView) {
    const dom = view.dom.ownerDocument.createElement("span");
    dom.className = "sg-fold sg-fold-open";
    dom.textContent = "fold";
    dom.title = "Fold the front matter";
    dom.setAttribute("role", "button");
    dom.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const { state } = view;
      const end = frontMatterEnd(state.doc);
      const { main } = state.selection;
      view.dispatch({
        effects: setFolded.of(true),
        selection:
          main.from <= end
            ? { anchor: Math.min(end + 1, state.doc.length) }
            : undefined,
      });
    });
    return dom;
  }

  override ignoreEvent() {
    return true;
  }
}

interface Fold {
  /** What the decorations depend on: whether the fold is closed, and the lines it covers. */
  key: string;
  decorations: DecorationSet;
}

function fold(state: EditorState, previous?: Fold): Fold {
  const end = frontMatterEnd(state.doc);
  const folded = foldedFrontMatter(state);
  const lines = end ? state.doc.lineAt(end).number : 0;
  const key = `${folded ? "closed" : "open"}:${end}:${lines}:${end ? state.doc.line(1).to : 0}`;
  if (previous?.key === key) return previous;
  let decorations = Decoration.none;
  if (folded) {
    decorations = Decoration.set(
      Decoration.replace({ widget: new FoldWidget(lines) }).range(0, end),
    );
  } else if (end) {
    decorations = Decoration.set(
      Decoration.widget({ widget: new FoldButton(), side: 1 }).range(
        state.doc.line(1).to,
      ),
    );
  }
  return { key, decorations };
}

// The fold replaces line breaks, so its decorations have to come from the state and not from a
// view plugin.
const folds = StateField.define<Fold>({
  create: (state) => fold(state),
  update: (value, tr) => fold(tr.state, value),
  provide: (field) =>
    EditorView.decorations.from(field, (value) => value.decorations),
});

/**
 * Hides front matter behind a fold that names the lines it covers. The fold is a single row
 * numbered as line 1, and the text after it keeps its own line numbers.
 */
export function frontMatterFold(): Extension {
  const atomic = EditorView.atomicRanges.of((view) => {
    const range = foldedFrontMatter(view.state);
    return range
      ? Decoration.set(Decoration.mark({}).range(range.from, range.to))
      : Decoration.none;
  });
  return [frontMatterFolded, folds, atomic];
}

/** The position to put the cursor at when a document is opened: after any front matter. */
export function initialCursor(state: EditorState): number {
  const end = frontMatterEnd(state.doc);
  return end ? Math.min(end + 1, state.doc.length) : 0;
}
