import { syntaxTree } from "@codemirror/language";
import {
  type EditorState,
  type Extension,
  Facet,
  type Range,
  RangeSet,
  StateEffect,
  StateField,
  Text,
  type Transaction,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  GutterMarker,
  gutter,
  gutterLineClass,
  gutterWidgetClass,
  WidgetType,
} from "@codemirror/view";
import { keepFrontMatterOpen } from "../frontmatter.ts";
import { frontMatterEnd, loadGrammars, parseText } from "../markdown/parser.ts";
import { renderLines } from "../render/dom.ts";
import { keepLineShown } from "../render/hidden.ts";
import { measureIn } from "../render/measure.ts";
import {
  type Block,
  blockKey,
  blocksAfterStaging,
  buildBlocks,
  type Hunk,
  indexAfter,
  type LineChange,
  linesOf,
  updateBlocks,
} from "./model.ts";

/** The text a document is compared with, and the line ending the index is written with. */
export interface Bases {
  index: Text;
  indexEol: string;
}

export const setBases = StateEffect.define<Bases | null>();

/** The base text. It is kept while changes aren't shown, ready for when they are. */
export const bases = StateField.define<Bases | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects)
      if (effect.is(setBases)) value = effect.value;
    return value;
  },
});

/** Goes with the new index when a change is staged, so that the others needn't be worked out again. */
const stage = StateEffect.define<Block>();

/** Called with the index's new text when a change is staged. */
const onIndex = Facet.define<(text: string) => void>();

class RemovedText extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  override eq(other: RemovedText) {
    return this.text === other.text;
  }

  override toDOM(view: EditorView) {
    const dom = view.dom.ownerDocument.createElement("del");
    dom.className = "sg-deleted";
    dom.textContent = this.text;
    return dom;
  }
}

/**
 * Lines a change took out, drawn where they were and rendered as the text around them is. They
 * have no line numbers in the document, so each row carries its number in the index. The key is
 * the change's when the lines are its first row, which carries its button, and null otherwise.
 */
class RemovedLines extends WidgetType {
  constructor(
    readonly base: Text,
    readonly from: number,
    readonly to: number,
    readonly key: string | null,
  ) {
    super();
  }

  override eq(other: RemovedLines) {
    return (
      this.base === other.base &&
      this.key === other.key &&
      this.from === other.from &&
      this.to === other.to
    );
  }

  override toDOM(view: EditorView) {
    const doc = view.dom.ownerDocument;
    const dom = doc.createElement("div");
    dom.className = "sg-removed";
    const draw = () => {
      const src = {
        doc: this.base,
        tree: parseText(this.base),
        frontMatterTo: frontMatterEnd(this.base),
        measure: measureIn(view),
      };
      const lines = renderLines(src, this.from + 1, this.to, [], doc);
      dom.replaceChildren(
        ...lines.map((line, i) => {
          const row = doc.createElement("div");
          row.className = "sg-removed-row";
          const number = row.appendChild(doc.createElement("span"));
          number.className = "sg-removed-number";
          number.textContent = String(this.from + 1 + i);
          row.appendChild(line);
          return row;
        }),
      );
    };
    draw();
    // Code in a language whose grammar is still loading is drawn plain, and again once it loads.
    loadGrammars(this.base).then(
      (loaded) => {
        if (loaded) {
          draw();
          view.requestMeasure();
        }
      },
      () => {},
    );
    return dom;
  }

  override ignoreEvent() {
    return true;
  }
}

class ChangeClass extends GutterMarker {
  constructor(override readonly elementClass: string) {
    super();
  }

  override eq(other: ChangeClass) {
    return this.elementClass === other.elementClass;
  }
}

const addedGutterClass = new ChangeClass("sg-gutter-added");
const removedGutterClass = new ChangeClass("sg-gutter-removed");

const label = "Stage";

class ActionMarker extends GutterMarker {
  constructor(readonly key: string) {
    super();
  }

  override eq(other: ActionMarker) {
    return this.key === other.key;
  }

  override toDOM(view: EditorView) {
    const dom = view.dom.ownerDocument.createElement("button");
    dom.type = "button";
    dom.className = "sg-action";
    dom.textContent = label;
    dom.addEventListener("mousedown", (event) => {
      event.preventDefault();
      act(view, this.key);
    });
    return dom;
  }
}

/** Holds the buttons' column at a button's width, so that text never re-wraps as buttons come and go. */
class ActionSpacer extends GutterMarker {
  override toDOM(view: EditorView) {
    const dom = view.dom.ownerDocument.createElement("span");
    dom.className = "sg-action-spacer";
    dom.textContent = label;
    return dom;
  }
}

interface Model {
  blocks: Block[];
  decorations: DecorationSet;
  classes: RangeSet<GutterMarker>;
  actions: RangeSet<GutterMarker>;
}

/** Whether any of the document's lines from `from` up to `to`, counted from zero, are in a table. */
function touchesTable(state: EditorState, from: number, to: number): boolean {
  let found = false;
  syntaxTree(state).iterate({
    from: state.doc.line(from + 1).from,
    to: state.doc.line(to).to,
    enter(node) {
      if (node.name === "Table") found = true;
      return !found && !/^(Paragraph|FencedCode|CodeBlock)$/.test(node.name);
    },
  });
  return found;
}

/**
 * Whether a change can show lines as edits. A table's rows are drawn as a whole, so an edit
 * inside one would be hidden; the row as it was is shown above the row as it is instead.
 */
const canEditIn = (state: EditorState) => (hunk: Hunk) =>
  !touchesTable(state, hunk.fromB, hunk.toB);

/** Works out every change from the start. */
function build(state: EditorState): Model | null {
  const base = state.field(bases);
  if (!base) return null;
  const index = linesOf(base.index);
  return draw(
    state,
    base,
    buildBlocks(index, linesOf(state.doc), canEditIn(state)),
  );
}

/** The lines of the document an edit replaced, and how many lines replaced them. */
function lineChange(tr: Transaction): LineChange {
  let fromA = Number.MAX_SAFE_INTEGER;
  let toA = 0;
  let toB = 0;
  tr.changes.iterChangedRanges((from, to, _fromB, endB) => {
    fromA = Math.min(fromA, from);
    toA = Math.max(toA, to);
    toB = Math.max(toB, endB);
  });
  const from = tr.startState.doc.lineAt(fromA).number - 1;
  return {
    from,
    to: tr.startState.doc.lineAt(toA).number,
    length: tr.state.doc.lineAt(toB).number - from,
  };
}

/** Draws the changes. */
function draw(state: EditorState, base: Bases, blocks: Block[]): Model {
  const { doc } = state;
  const index = linesOf(base.index);
  const decorations: Range<Decoration>[] = [];
  const classes: Range<GutterMarker>[] = [];
  const actions: Range<GutterMarker>[] = [];
  for (const block of blocks) {
    const key = blockKey(block);
    const { hunk } = block;
    const edited = new Set<number>();
    for (const edit of block.edits) {
      edited.add(edit.b);
      const line = doc.line(edit.b + 1);
      const old = index[edit.a] as string;
      decorations.push(
        Decoration.line({ class: "sg-edited" }).range(line.from),
      );
      classes.push(addedGutterClass.range(line.from));
      for (const span of edit.spans) {
        if (span.toA > span.fromA)
          decorations.push(
            Decoration.widget({
              widget: new RemovedText(old.slice(span.fromA, span.toA)),
              side: -1,
            }).range(line.from + span.fromB),
          );
        if (span.toB > span.fromB)
          decorations.push(
            Decoration.mark({ class: "sg-inserted" }).range(
              line.from + span.fromB,
              line.from + span.toB,
            ),
          );
      }
    }
    for (let n = hunk.fromB; n < hunk.toB; n++) {
      if (edited.has(n)) continue;
      const line = doc.line(n + 1);
      decorations.push(Decoration.line({ class: "sg-added" }).range(line.from));
      classes.push(addedGutterClass.range(line.from));
    }
    // The change's first row carries its button: removed lines drawn above its first line, or
    // that line itself.
    let buttoned = false;
    for (const removal of block.removals) {
      const first = removal.at === hunk.fromB;
      buttoned ||= first;
      const widget = new RemovedLines(
        base.index,
        removal.from,
        removal.to,
        first ? key : null,
      );
      // Lines removed from the end of the document go below its last line.
      const below = removal.at >= doc.lines;
      decorations.push(
        Decoration.widget({ widget, block: true, side: below ? 1 : -1 }).range(
          below ? doc.length : doc.line(removal.at + 1).from,
        ),
      );
    }
    if (!buttoned)
      actions.push(new ActionMarker(key).range(doc.line(hunk.fromB + 1).from));
  }
  return {
    blocks,
    decorations: Decoration.set(decorations, true),
    classes: RangeSet.of(classes, true),
    actions: RangeSet.of(actions, true),
  };
}

const model = StateField.define<Model | null>({
  create: build,
  update(value, tr) {
    const base = tr.state.field(bases);
    if (!value || !base || base !== tr.startState.field(bases)) {
      const staged = tr.effects.find((effect) => effect.is(stage));
      if (value && base && staged && !tr.docChanged)
        return draw(
          tr.state,
          base,
          blocksAfterStaging(value.blocks, staged.value),
        );
      return build(tr.state);
    }
    if (!tr.docChanged) return value;
    return draw(
      tr.state,
      base,
      updateBlocks(
        value.blocks,
        linesOf(base.index),
        linesOf(tr.state.doc),
        lineChange(tr),
        canEditIn(tr.state),
      ),
    );
  },
  provide: (field) => [
    EditorView.decorations.from(
      field,
      (value) => value?.decorations ?? Decoration.none,
    ),
    gutterLineClass.from(field, (value) => value?.classes ?? RangeSet.empty),
  ],
});

/** The changes being shown, or an empty list when none are. */
export function shownChanges(state: EditorState): readonly Block[] {
  return state.field(model, false)?.blocks ?? [];
}

/**
 * Stages a change. What the index should hold is worked out as text, the index with that one
 * change applied, and handed over; nothing here knows about Git.
 */
function act(view: EditorView, key: string) {
  const { state } = view;
  const base = state.field(bases);
  const block = shownChanges(state).find((b) => blockKey(b) === key);
  if (!base || !block) return;
  const lines = indexAfter(block, linesOf(base.index), linesOf(state.doc));
  view.dispatch({
    effects: [setBases.of({ ...base, index: Text.of(lines) }), stage.of(block)],
  });
  const text = lines.join(base.indexEol);
  for (const notify of state.facet(onIndex)) notify(text);
}

/** Stages the change with the given key, as its button would. */
export function applyChange(view: EditorView, key: string) {
  act(view, key);
}

/** Whether a change touches the front matter, which then has to be in view. */
function touchesFrontMatter(state: EditorState): boolean {
  const end = frontMatterEnd(state.doc);
  if (!end) return false;
  const lines = state.doc.lineAt(end).number;
  return shownChanges(state).some(({ hunk }) => hunk.fromB < lines);
}

/**
 * Whether a change puts in the line with the given number, counted from one, or takes out lines
 * next to it. A line of syntax that is usually hidden is then kept in view, so that the change
 * can be read in place.
 */
function touchesLine(state: EditorState, number: number): boolean {
  const line = number - 1;
  return shownChanges(state).some(
    ({ hunk, removals }) =>
      (hunk.fromB <= line && line < hunk.toB) ||
      removals.some(({ at }) => at === line || at === line + 1),
  );
}

/**
 * Shows the document's unstaged changes in place, the differences between the index and the
 * document, each with a button that stages it. A staged change is in the index, so it is shown
 * as plain text, as VS Code's diff view against the index shows it.
 */
export function changesView(setIndex: (text: string) => void): Extension {
  return [
    model,
    onIndex.of(setIndex),
    keepFrontMatterOpen.of(touchesFrontMatter),
    keepLineShown.of(touchesLine),
    gutterWidgetClass.of((_view, widget) =>
      widget instanceof RemovedLines ? removedGutterClass : null,
    ),
    gutter({
      class: "sg-actions",
      side: "after",
      markers: (view) => view.state.field(model)?.actions ?? RangeSet.empty,
      widgetMarker: (_view, widget) =>
        widget instanceof RemovedLines && widget.key !== null
          ? new ActionMarker(widget.key)
          : null,
      initialSpacer: () => new ActionSpacer(),
    }),
  ];
}
