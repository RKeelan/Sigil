import { syntaxTree } from "@codemirror/language";
import {
  type EditorState,
  type Extension,
  StateField,
} from "@codemirror/state";
import {
  type EditorView,
  GutterMarker,
  gutter,
  highlightActiveLineGutter,
} from "@codemirror/view";
import { frontMatterEnd } from "./markdown/parser.ts";

class NumberMarker extends GutterMarker {
  constructor(
    readonly text: string,
    readonly heading: number,
  ) {
    super();
  }

  override eq(other: NumberMarker) {
    return this.text === other.text && this.heading === other.heading;
  }

  override toDOM(view: EditorView) {
    const dom = view.dom.ownerDocument.createElement("span");
    // A heading's number carries a strut the size of the heading, so that the number sits on the
    // heading's baseline and not at the top of its row.
    dom.className = this.heading
      ? `sg-number sg-number-h${this.heading}`
      : "sg-number";
    dom.textContent = this.text;
    return dom;
  }
}

/** The level of the heading on the line from `from` to `to`, or zero. */
function headingLevel(state: EditorState, from: number, to: number): number {
  if (from < frontMatterEnd(state.doc)) return 0;
  let level = 0;
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      const heading = /^(ATX|Setext)Heading(\d)$/.exec(node.name);
      if (heading) {
        const mark = heading[1] === "Setext" ? node.node.lastChild : null;
        const underline = mark ? state.doc.lineAt(mark.from).from : -1;
        if (node.from <= to && node.to >= from && from !== underline)
          level = Number(heading[2]);
        return false;
      }
      return !/^(Paragraph|Table|FencedCode|CodeBlock|HTMLBlock)$/.test(
        node.name,
      );
    },
  });
  return level;
}

/**
 * How many digits the gutter has room for: at least three, and as many as the longest line
 * number the document has had, so that the gutter widens when it must and never narrows.
 */
const digits = StateField.define<number>({
  create: (state) => Math.max(3, String(state.doc.lines).length),
  update: (value, tr) => Math.max(value, String(tr.state.doc.lines).length),
});

/**
 * A gutter that numbers source lines. A wrapped line is numbered once, on its first row, and a
 * heading's number sits on the heading's baseline, which CodeMirror's own line-number gutter
 * has no way to arrange.
 */
export function lineNumbers(): Extension {
  return [
    digits,
    gutter({
      class: "sg-numbers",
      lineMarker(view, line) {
        const number = view.state.doc.lineAt(line.from).number;
        return new NumberMarker(
          String(number),
          headingLevel(view.state, line.from, line.to),
        );
      },
      lineMarkerChange: (update) =>
        syntaxTree(update.startState) !== syntaxTree(update.state),
      initialSpacer: (view) =>
        new NumberMarker("0".repeat(view.state.field(digits)), 0),
      updateSpacer: (spacer, update) =>
        update.startState.field(digits) === update.state.field(digits)
          ? spacer
          : new NumberMarker("0".repeat(update.state.field(digits)), 0),
    }),
    highlightActiveLineGutter(),
  ];
}
