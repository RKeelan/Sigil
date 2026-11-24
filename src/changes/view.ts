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
import { frontMatterEnd, parseText } from "../markdown/parser.ts";
import { renderLines } from "../render/dom.ts";
import { measureIn } from "../render/measure.ts";
import {
  type Block,
  blockKey,
  buildBlocks,
  diffLines,
  type Hunk,
  indexAfter,
  linesOf,
} from "./model.ts";

/** The texts a document is compared with, and the line ending the index is written with. */
export interface Bases {
  head: Text;
  index: Text;
  indexEol: string;
}

export const setBases = StateEffect.define<Bases | null>();

/** The base texts. They are kept while changes aren't shown, ready for when they are. */
export const bases = StateField.define<Bases | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects)
      if (effect.is(setBases)) value = effect.value;
    return value;
  },
});

/** Called with the index's new text when a change is staged or unstaged. */
const onIndex = Facet.define<(text: string) => void>();

type Kind = Block["kind"];

class RemovedText extends WidgetType {
  constructor(
    readonly text: string,
    readonly kind: Kind,
  ) {
    super();
  }

  override eq(other: RemovedText) {
    return this.text === other.text && this.kind === other.kind;
  }

  override toDOM(view: EditorView) {
    const dom = view.dom.ownerDocument.createElement("del");
    dom.className = `sg-deleted sg-deleted-${this.kind}`;
    dom.textContent = this.text;
    return dom;
  }
}

/**
 * Lines a change took out, drawn where they were and rendered as the text around them is. They
 * have no line numbers in the document, so each row carries its number in the base text.
 */
class RemovedLines extends WidgetType {
  constructor(
    readonly kind: Kind,
    readonly base: Text,
    readonly from: number,
    readonly to: number,
    readonly key: string,
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
    dom.className = `sg-removed sg-removed-${this.kind}`;
    const src = {
      doc: this.base,
      tree: parseText(this.base),
      frontMatterTo: frontMatterEnd(this.base),
      measure: measureIn(view),
    };
    const lines = renderLines(src, this.from + 1, this.to, [], doc);
    lines.forEach((line, i) => {
      const row = dom.appendChild(doc.createElement("div"));
      row.className = "sg-removed-row";
      const number = row.appendChild(doc.createElement("span"));
      number.className = "sg-removed-number";
      number.textContent = String(this.from + 1 + i);
      row.appendChild(line);
    });
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

const gutterClass: Record<Kind, ChangeClass> = {
  unstaged: new ChangeClass("sg-gutter-unstaged"),
  staged: new ChangeClass("sg-gutter-staged"),
};

const removedGutterClass: Record<Kind, ChangeClass> = {
  unstaged: new ChangeClass("sg-gutter-removed-unstaged"),
  staged: new ChangeClass("sg-gutter-removed-staged"),
};

const labels: Record<Kind, string> = { unstaged: "Stage", staged: "Unstage" };

class ActionMarker extends GutterMarker {
  constructor(
    readonly kind: Kind,
    readonly key: string,
  ) {
    super();
  }

  override eq(other: ActionMarker) {
    return this.key === other.key;
  }

  override toDOM(view: EditorView) {
    const dom = view.dom.ownerDocument.createElement("button");
    dom.type = "button";
    dom.className = `sg-action sg-action-${this.kind}`;
    dom.textContent = labels[this.kind];
    dom.addEventListener("mousedown", (event) => {
      event.preventDefault();
      act(view, this.key);
    });
    return dom;
  }
}

/** Holds the buttons' column at the width of its wider label, so that text never re-wraps. */
class ActionSpacer extends GutterMarker {
  override toDOM(view: EditorView) {
    const dom = view.dom.ownerDocument.createElement("span");
    dom.className = "sg-action-spacer";
    dom.textContent = labels.staged;
    return dom;
  }
}

interface Model {
  blocks: Block[];
  decorations: DecorationSet;
  classes: RangeSet<GutterMarker>;
  actions: RangeSet<GutterMarker>;
}

const stagedHunks = new WeakMap<Bases, Hunk[]>();

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

function build(state: EditorState): Model | null {
  const base = state.field(bases);
  if (!base) return null;
  const { doc } = state;
  const head = linesOf(base.head);
  const index = linesOf(base.index);
  let staged = stagedHunks.get(base);
  if (!staged) {
    staged = diffLines(head, index);
    stagedHunks.set(base, staged);
  }
  const blocks = buildBlocks(head, index, linesOf(doc), staged);
  const decorations: Range<Decoration>[] = [];
  const classes: Range<GutterMarker>[] = [];
  const actions: Range<GutterMarker>[] = [];
  for (const block of blocks) {
    const { kind } = block;
    const key = blockKey(block);
    const before = kind === "unstaged" ? index : head;
    const first = block.added[0];
    // A table's rows are drawn as a whole, so an edit inside one would be hidden. The row as it
    // was is shown above the row as it is instead.
    const inline =
      block.edits !== null &&
      first !== undefined &&
      !touchesTable(state, first.from, first.from + block.edits.length);
    if (block.edits && first && inline) {
      block.edits.forEach((spans, i) => {
        const line = doc.line(first.from + i + 1);
        const old = before[block.hunk.fromA + i] as string;
        decorations.push(
          Decoration.line({ class: `sg-edited sg-edited-${kind}` }).range(
            line.from,
          ),
        );
        classes.push(gutterClass[kind].range(line.from));
        for (const span of spans) {
          if (span.toA > span.fromA)
            decorations.push(
              Decoration.widget({
                widget: new RemovedText(old.slice(span.fromA, span.toA), kind),
                side: -1,
              }).range(line.from + span.fromB),
            );
          if (span.toB > span.fromB)
            decorations.push(
              Decoration.mark({
                class: `sg-inserted sg-inserted-${kind}`,
              }).range(line.from + span.fromB, line.from + span.toB),
            );
        }
      });
      actions.push(
        new ActionMarker(kind, key).range(doc.line(first.from + 1).from),
      );
      continue;
    }
    let anchored = false;
    if (block.removed) {
      const widget = new RemovedLines(
        kind,
        kind === "unstaged" ? base.index : base.head,
        block.removed.from,
        block.removed.to,
        key,
      );
      // Lines removed from the end of the document go below its last line. Where staged and
      // unstaged removals meet, the staged lines, which are the older, come first.
      const below = block.at >= doc.lines;
      const order = kind === "staged" ? 1 : 2;
      decorations.push(
        Decoration.widget({
          widget,
          block: true,
          side: below ? order : order - 3,
        }).range(below ? doc.length : doc.line(block.at + 1).from),
      );
      anchored = true;
    }
    for (const run of block.added) {
      for (let n = run.from; n < run.to; n++) {
        const line = doc.line(n + 1);
        decorations.push(
          Decoration.line({ class: `sg-added sg-added-${kind}` }).range(
            line.from,
          ),
        );
        classes.push(gutterClass[kind].range(line.from));
        if (!anchored) {
          actions.push(new ActionMarker(kind, key).range(line.from));
          anchored = true;
        }
      }
    }
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
    if (tr.docChanged || tr.startState.field(bases) !== tr.state.field(bases))
      return build(tr.state);
    return value;
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
 * Stages or unstages a change. What the index should hold is worked out as text, the index with
 * that one change applied or taken back, and handed over; nothing here knows about Git.
 */
function act(view: EditorView, key: string) {
  const { state } = view;
  const base = state.field(bases);
  const block = shownChanges(state).find((b) => blockKey(b) === key);
  if (!base || !block) return;
  const lines = indexAfter(
    block,
    linesOf(base.head),
    linesOf(base.index),
    linesOf(state.doc),
  );
  view.dispatch({ effects: setBases.of({ ...base, index: Text.of(lines) }) });
  const text = lines.join(base.indexEol);
  for (const notify of state.facet(onIndex)) notify(text);
}

/** Stages or unstages the change with the given key, as its button would. */
export function applyChange(view: EditorView, key: string) {
  act(view, key);
}

/** Whether a change touches the front matter, which then has to be in view. */
function touchesFrontMatter(state: EditorState): boolean {
  const end = frontMatterEnd(state.doc);
  if (!end) return false;
  const lines = state.doc.lineAt(end).number;
  return shownChanges(state).some(
    (block) => block.at < lines || block.added.some((run) => run.from < lines),
  );
}

/**
 * Shows the document's uncommitted changes in place: unstaged changes, which are between the
 * index and the document, and staged ones, which are between HEAD and the index, each with a
 * button that stages or unstages it.
 */
export function changesView(setIndex: (text: string) => void): Extension {
  return [
    model,
    onIndex.of(setIndex),
    keepFrontMatterOpen.of(touchesFrontMatter),
    gutterWidgetClass.of((_view, widget) =>
      widget instanceof RemovedLines ? removedGutterClass[widget.kind] : null,
    ),
    gutter({
      class: "sg-actions",
      side: "after",
      markers: (view) => view.state.field(model)?.actions ?? RangeSet.empty,
      widgetMarker: (_view, widget) =>
        widget instanceof RemovedLines
          ? new ActionMarker(widget.kind, widget.key)
          : null,
      initialSpacer: () => new ActionSpacer(),
    }),
  ];
}
