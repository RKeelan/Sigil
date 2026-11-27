import { type Extension, StateField } from "@codemirror/state";
import {
  type EditorView,
  GutterMarker,
  gutter,
  highlightActiveLineGutter,
  ViewPlugin,
} from "@codemirror/view";

class NumberMarker extends GutterMarker {
  constructor(readonly text: string) {
    super();
  }

  override eq(other: NumberMarker) {
    return this.text === other.text;
  }

  override toDOM(view: EditorView) {
    const dom = view.dom.ownerDocument.createElement("span");
    dom.className = "sg-number";
    dom.textContent = this.text;
    return dom;
  }
}

/**
 * How many digits the gutter has room for: at least three, and as many as the longest line
 * number the document has had, so that the gutter widens when it must and never narrows.
 */
const digits = StateField.define<number>({
  create: (state) => Math.max(3, String(state.doc.lines).length),
  update: (value, tr) => Math.max(value, String(tr.state.doc.lines).length),
});

interface Span {
  top: number;
  bottom: number;
}

const middle = (span: Span) => (span.top + span.bottom) / 2;

/** Whether two boxes are on the same row: the middle of one lies within the other. */
const sameRow = (a: Span, b: Span) =>
  (middle(a) >= b.top && middle(a) <= b.bottom) ||
  (middle(b) >= a.top && middle(b) <= a.bottom);

/**
 * The vertical extent of what is drawn on a line's first row: its text, images and rules. Text
 * counts by the height of its font, not its leading, as the number's own text does. Returns
 * null for a line with nothing drawn on it.
 */
export function firstRow(line: HTMLElement): Span | null {
  const doc = line.ownerDocument;
  const boxes: Span[] = [];
  // 0x5 shows elements and text.
  const walker = doc.createTreeWalker(line, 0x5);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === 3) {
      const range = doc.createRange();
      range.selectNodeContents(node);
      boxes.push(...(range.getClientRects?.() ?? []));
    } else if ((node as Element).matches(".sg-image, .sg-rule")) {
      boxes.push((node as Element).getBoundingClientRect());
    }
  }
  const drawn = boxes.filter((box) => box.bottom > box.top);
  const first = drawn[0];
  if (!first) return null;
  const row = drawn.filter((box) => sameRow(box, first));
  return {
    top: Math.min(...row.map((box) => box.top)),
    bottom: Math.max(...row.map((box) => box.bottom)),
  };
}

/**
 * Moves each line's number to the middle of the line's first row. A heading or an image makes
 * its row taller than the gutter's, and only the page knows by how much. A wrapped line keeps
 * its number on its first row, beside the text it starts with.
 */
const centre = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {
      this.schedule();
    }

    update() {
      this.schedule();
    }

    schedule() {
      this.view.requestMeasure({
        key: this,
        read: (view) => this.read(view),
        write: (moves) => {
          for (const [number, offset] of moves)
            number.style.top = offset ? `${offset}px` : "";
        },
      });
    }

    read(view: EditorView): [HTMLElement, number][] {
      const lines = new Map<number, HTMLElement>();
      for (const line of view.contentDOM.querySelectorAll<HTMLElement>(
        ":scope > .cm-line",
      )) {
        const at = view.posAtDOM(line, 0);
        lines.set(view.state.doc.lineAt(at).number, line);
      }
      const moves: [HTMLElement, number][] = [];
      for (const number of view.dom.querySelectorAll<HTMLElement>(
        ".sg-numbers .sg-number",
      )) {
        const line = lines.get(Number(number.textContent));
        const row = line && firstRow(line);
        const current = Number.parseFloat(number.style.top) || 0;
        let offset = 0;
        if (row) {
          // Where the number would be unmoved, less where it is now, gives how far to move it.
          const box = number.getBoundingClientRect();
          offset = Math.round((middle(row) - middle(box) + current) * 2) / 2;
        }
        if (offset !== current) moves.push([number, offset]);
      }
      return moves;
    }
  },
);

/**
 * A gutter that numbers source lines. A wrapped line is numbered once, on its first row, which
 * CodeMirror's own line-number gutter has no way to arrange, and each number is centred on that
 * row, however tall the row is.
 */
export function lineNumbers(): Extension {
  return [
    digits,
    gutter({
      class: "sg-numbers",
      lineMarker(view, line) {
        return new NumberMarker(
          String(view.state.doc.lineAt(line.from).number),
        );
      },
      initialSpacer: (view) =>
        new NumberMarker("0".repeat(view.state.field(digits))),
      updateSpacer: (spacer, update) =>
        update.startState.field(digits) === update.state.field(digits)
          ? spacer
          : new NumberMarker("0".repeat(update.state.field(digits))),
    }),
    highlightActiveLineGutter(),
    centre,
  ];
}
