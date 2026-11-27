import { syntaxTree } from "@codemirror/language";
import { type Extension, type Range, StateEffect } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { frontMatterEnd } from "../markdown/parser.ts";
import { widgetDOM } from "./dom.ts";
import { syntaxLines } from "./hidden.ts";
import { measureIn, remeasure } from "./measure.ts";
import {
  buildPieces,
  type Piece,
  type Reveal,
  type Source,
  type WidgetSpec,
} from "./pieces.ts";
import { pointerDown, type Revealed, revealed, setPointer } from "./reveal.ts";

export { type RevealScope, revealScope } from "./reveal.ts";

/**
 * Whether syntax is shown. In line scope, syntax is shown where it is on a revealed line. In
 * construct scope, it is shown where the selection touches the construct it belongs to, ends
 * included, so that a cursor just before or after a construct reveals it.
 */
export function revealIn({ scope, spans }: Revealed): Reveal {
  const touches = (from: number, to: number) =>
    spans.some((span) => span.from <= to && span.to >= from);
  if (scope === "line") return touches;
  return (from, to, construct) =>
    construct ? touches(construct.from, construct.to) : touches(from, to);
}

function sameSpec(a: WidgetSpec, b: WidgetSpec): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "row" && b.type === "row") {
    return (
      a.kind === b.kind &&
      a.widths.join() === b.widths.join() &&
      a.floors.join() === b.floors.join() &&
      a.aligns.join() === b.aligns.join() &&
      a.cells.length === b.cells.length &&
      a.cells.every((cell, i) => {
        const other = b.cells[i];
        return cell.text === other?.text && cell.offset === other.offset;
      })
    );
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

class SpecWidget extends WidgetType {
  constructor(readonly spec: WidgetSpec) {
    super();
  }

  override eq(other: SpecWidget) {
    return sameSpec(this.spec, other.spec);
  }

  override toDOM(view: EditorView) {
    const dom = widgetDOM(this.spec, view.dom.ownerDocument);
    if (this.spec.type === "image") {
      // A picture's height isn't known until it loads.
      dom.addEventListener("load", () => view.requestMeasure());
      dom.addEventListener("error", () => view.requestMeasure());
    }
    return dom;
  }

  override ignoreEvent() {
    return false;
  }
}

function decoration(piece: Piece): Range<Decoration> {
  switch (piece.kind) {
    case "line": {
      const attributes: Record<string, string> = { class: piece.cls };
      if (piece.style) attributes.style = piece.style;
      return Decoration.line({ attributes }).range(piece.at);
    }
    case "mark":
      return Decoration.mark({
        class: piece.cls,
        attributes: piece.attrs,
      }).range(piece.from, piece.to);
    case "hide":
      return Decoration.replace({}).range(piece.from, piece.to);
    case "widget": {
      const widget = new SpecWidget(piece.spec);
      if (piece.from === piece.to) {
        const side = piece.spec.type === "bar" ? -1 : 1;
        return Decoration.widget({ widget, side }).range(piece.from);
      }
      return Decoration.replace({ widget }).range(piece.from, piece.to);
    }
  }
}

const redraw = StateEffect.define<null>();

function build(view: EditorView): DecorationSet {
  const reveal = revealIn(view.state.field(revealed));
  const src: Source = {
    doc: view.state.doc,
    tree: syntaxTree(view.state),
    frontMatterTo: frontMatterEnd(view.state.doc),
    measure: measureIn(view),
  };
  const ranges: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    for (const piece of buildPieces(src, from, to, reveal)) {
      if (
        piece.kind !== "line" &&
        piece.kind !== "widget" &&
        piece.from >= piece.to
      )
        continue;
      ranges.push(decoration(piece));
    }
  }
  return Decoration.set(ranges, true);
}

const preview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    private destroyed = false;
    private readonly release: () => void;

    constructor(readonly view: EditorView) {
      this.decorations = build(view);
      const doc = view.dom.ownerDocument;
      const up = () => {
        if (view.state.field(pointerDown, false))
          view.dispatch({ effects: setPointer.of(false) });
      };
      // Text measured before a web font arrived was measured in the wrong font.
      const fonts = () => {
        remeasure(view, true);
        view.dispatch({ effects: redraw.of(null) });
      };
      // So was text measured before the editor was on the page, where it has no font yet. That
      // is put right before anything is painted.
      queueMicrotask(() => {
        if (!this.destroyed && remeasure(view))
          view.dispatch({ effects: redraw.of(null) });
      });
      doc.addEventListener("mouseup", up, true);
      doc.addEventListener("dragend", up, true);
      doc.fonts?.addEventListener("loadingdone", fonts);
      this.release = () => {
        doc.removeEventListener("mouseup", up, true);
        doc.removeEventListener("dragend", up, true);
        doc.fonts?.removeEventListener("loadingdone", fonts);
      };
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state) ||
        update.startState.field(revealed) !== update.state.field(revealed) ||
        (update.geometryChanged && remeasure(update.view)) ||
        update.transactions.some((tr) =>
          tr.effects.some((effect) => effect.is(redraw)),
        )
      )
        this.decorations = build(update.view);
    }

    destroy() {
      this.destroyed = true;
      this.release();
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** Ticks or unticks the task whose box was clicked. */
function toggleTask(view: EditorView, box: HTMLElement): boolean {
  const pos = view.posAtDOM(box);
  const text = view.state.sliceDoc(pos, pos + 3);
  if (!/^\[[ xX]\]$/.test(text)) return false;
  view.dispatch({
    changes: {
      from: pos + 1,
      to: pos + 2,
      insert: text[1] === " " ? "x" : " ",
    },
    userEvent: "input.toggle",
  });
  return true;
}

/** Puts the cursor in the cell of a rendered table row that was clicked. */
function enterCell(view: EditorView, target: HTMLElement): boolean {
  const row = target.closest<HTMLElement>(".sg-row");
  if (!row) return false;
  const cell = target.closest<HTMLElement>(".sg-cell");
  const pos = view.posAtDOM(row) + Number(cell?.dataset.offset ?? 0);
  view.dispatch({
    selection: { anchor: Math.min(pos, view.state.doc.length) },
  });
  view.focus();
  return true;
}

const pointer = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0) return false;
    const target = event.target as HTMLElement;
    if (target.closest?.(".sg-task") && view.dom.contains(target)) {
      const box = target.closest<HTMLElement>(".sg-task") as HTMLElement;
      if (toggleTask(view, box)) {
        event.preventDefault();
        return true;
      }
    }
    if (target.closest?.(".sg-row") && !target.closest(".sg-removed")) {
      event.preventDefault();
      return enterCell(view, target);
    }
    view.dispatch({ effects: setPointer.of(true) });
    return false;
  },
});

/**
 * Renders Markdown in place, showing the syntax of the lines or constructs the selection
 * touches, as `revealScope` says.
 */
export function livePreview(): Extension {
  return [pointerDown, revealed, preview, pointer, syntaxLines()];
}
