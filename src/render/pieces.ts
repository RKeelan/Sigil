import type { Line, Text } from "@codemirror/state";
import type { SyntaxNode, SyntaxNodeRef, Tree } from "@lezer/common";
import { highlightTree } from "@lezer/highlight";
import { type Item, linePrefix } from "../markdown/structure.ts";
import { codeHighlighter } from "./highlight.ts";

/** The width of one level of list indentation, in ems. */
export const INDENT = 1.6;
/** The width a quote's bar takes up, in ems. */
export const QUOTE = 1.2;

export type Align = "left" | "center" | "right";

/** A table cell: its source text, where it starts in its row, and how its text is rendered. */
export interface Cell {
  text: string;
  offset: number;
  pieces: Piece[];
}

/** A rendered stand-in for a piece of source text, as plain data. */
export type WidgetSpec =
  | { type: "bullet"; glyph: string }
  | { type: "task"; checked: boolean }
  | { type: "image"; src: string; alt: string }
  | { type: "rule" }
  | { type: "bar" }
  | {
      type: "row";
      kind: "header" | "delimiter" | "body";
      cells: Cell[];
      /** For each column, the width its widest cell needs on one row, in ems. */
      widths: number[];
      /** For each column, the width of its longest word, below which words have to break. */
      floors: number[];
      aligns: Align[];
    };

/**
 * One instruction for rendering a stretch of source: a class on a line, a class on a range, a
 * range to leave out, or a widget to put in a range's place. Both the editor's decorations and
 * the static renderer are built from these, so removed text is drawn the way live text is.
 */
export type Piece =
  | { kind: "line"; at: number; cls: string; style?: string }
  | {
      kind: "mark";
      from: number;
      to: number;
      cls: string;
      attrs?: Record<string, string>;
    }
  | { kind: "hide"; from: number; to: number }
  | { kind: "widget"; from: number; to: number; spec: WidgetSpec };

/** How a stretch of text is set, as far as its width goes. */
export interface TextStyle {
  bold: boolean;
  italic: boolean;
  code: boolean;
}

/** Measures the width of text set on one row, in ems of the body text. */
export type Measure = (text: string, style: TextStyle) => number;

export interface Source {
  doc: Text;
  tree: Tree;
  /** The end of the front matter, or zero. */
  frontMatterTo: number;
  /** Measures text, so that a table's columns can be made to fit their cells. */
  measure?: Measure;
}

/** Whether the source between two positions is shown as typed rather than rendered. */
export type Reveal = (from: number, to: number) => boolean;

const never: Reveal = () => false;

/** Works out how to render the lines that the range from `from` to `to` touches. */
export function buildPieces(
  src: Source,
  from: number,
  to: number,
  reveal: Reveal = never,
): Piece[] {
  const out: Piece[] = [];
  const first = src.doc.lineAt(from);
  const last = src.doc.lineAt(to);
  const mono = new Set<number>();
  blocks(src, first.from, last.to, reveal, mono, out);
  prefixes(src, first, last, reveal, mono, out);
  return out;
}

function blocks(
  src: Source,
  from: number,
  to: number,
  reveal: Reveal,
  mono: Set<number>,
  out: Piece[],
) {
  const { doc } = src;
  const eachLine = (node: SyntaxNodeRef, f: (line: Line) => void) => {
    const start = Math.max(node.from, from);
    const end = Math.min(node.to, to);
    for (let pos = start; pos <= end;) {
      const line = doc.lineAt(pos);
      f(line);
      pos = line.to + 1;
    }
  };
  src.tree.iterate({
    from,
    to,
    enter(node) {
      const name = node.name;
      if (name === "Document") return;
      if (node.from < src.frontMatterTo) return false;
      const heading = /^(ATX|Setext)Heading(\d)$/.exec(name);
      if (heading) {
        const mark = heading[1] === "Setext" ? node.node.lastChild : null;
        const markLine = mark ? doc.lineAt(mark.from).from : -1;
        // The size goes on the heading's text and not on its line, so that the line's padding and
        // the boxes before its content are measured in the size of ordinary text.
        eachLine(node, (line) => {
          if (line.from === markLine) {
            out.push({ kind: "line", at: line.from, cls: "sg-setext" });
            return;
          }
          out.push({
            kind: "line",
            at: line.from,
            cls: `sg-heading sg-heading-${heading[2] as string}`,
          });
          out.push({
            kind: "mark",
            from: Math.max(node.from, line.from),
            to: Math.min(node.to, line.to),
            cls: `sg-h sg-h${heading[2] as string}`,
          });
        });
        return;
      }
      switch (name) {
        case "HeaderMark":
          headerMark(node, src, reveal, out);
          return false;
        case "FencedCode":
        case "CodeBlock":
          code(node.node, src, from, to, reveal, mono, out);
          return false;
        case "HorizontalRule":
          if (reveal(node.from, node.to)) {
            out.push(mark(node, "sg-syntax"));
          } else {
            out.push({
              kind: "widget",
              from: node.from,
              to: node.to,
              spec: { type: "rule" },
            });
          }
          return false;
        case "Table":
          table(node.node, src, from, to, reveal, mono, out);
          return false;
        case "HTMLBlock":
        case "CommentBlock":
        case "ProcessingInstructionBlock":
          eachLine(node, (line) => {
            out.push({ kind: "line", at: line.from, cls: "sg-html-line" });
            mono.add(line.from);
          });
          return false;
        case "LinkReference":
          out.push(mark(node, "sg-syntax"));
          return false;
        case "QuoteFence":
          syntax(node, reveal(node.from, node.to), out);
          return false;
        case "Task": {
          const box = node.node.firstChild;
          if (box && /\[[xX]\]/.test(doc.sliceString(box.from, box.to)))
            out.push({
              kind: "mark",
              from: box.to,
              to: node.to,
              cls: "sg-done",
            });
          return;
        }
        case "TaskMarker":
          if (reveal(node.from, node.to)) {
            out.push(mark(node, "sg-syntax"));
          } else {
            const checked = /[xX]/.test(doc.sliceString(node.from, node.to));
            out.push({
              kind: "widget",
              from: node.from,
              to: node.to,
              spec: { type: "task", checked },
            });
          }
          return false;
        default:
          return inline(node, src, reveal(node.from, node.to), out);
      }
    },
  });
}

function mark(node: { from: number; to: number }, cls: string): Piece {
  return { kind: "mark", from: node.from, to: node.to, cls };
}

/** Shows a piece of syntax muted, or leaves it out. */
function syntax(
  node: { from: number; to: number },
  shown: boolean,
  out: Piece[],
) {
  if (node.from === node.to) return;
  if (shown) out.push(mark(node, "sg-syntax"));
  else out.push({ kind: "hide", from: node.from, to: node.to });
}

function headerMark(
  node: SyntaxNodeRef,
  src: Source,
  reveal: Reveal,
  out: Piece[],
) {
  const parent = node.node.parent;
  if (!parent || parent.name.startsWith("Setext")) {
    out.push(mark(node, "sg-syntax"));
    return;
  }
  const line = src.doc.lineAt(node.from);
  if (reveal(line.from, line.to)) {
    out.push(mark(node, "sg-syntax"));
    return;
  }
  let { from, to } = node;
  const text = line.text;
  if (from === parent.from) {
    while (to < line.to && /[ \t]/.test(text[to - line.from] as string)) to++;
  } else {
    while (
      from > line.from &&
      /[ \t]/.test(text[from - line.from - 1] as string)
    )
      from--;
  }
  out.push({ kind: "hide", from, to });
}

function code(
  node: SyntaxNode,
  src: Source,
  from: number,
  to: number,
  reveal: Reveal,
  mono: Set<number>,
  out: Piece[],
) {
  const { doc } = src;
  const first = doc.lineAt(node.from).from;
  const last = doc.lineAt(node.to).from;
  for (let pos = Math.max(node.from, from); pos <= Math.min(node.to, to);) {
    const line = doc.lineAt(pos);
    let cls = "sg-code-line";
    if (line.from === first) cls += " sg-code-first";
    if (line.from === last) cls += " sg-code-last";
    out.push({ kind: "line", at: line.from, cls });
    mono.add(line.from);
    pos = line.to + 1;
  }
  if (node.name !== "FencedCode") return;
  const shown = reveal(node.from, node.to);
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.to < from || child.from > to) continue;
    if (child.name === "CodeMark") syntax(child, shown, out);
    else if (child.name === "CodeInfo") out.push(mark(child, "sg-code-info"));
  }
  // The block's code has a tree of its own, in its language, when the info string names one
  // that is highlighted. A token that runs over several lines, such as a block comment, is
  // marked a line at a time, since rendered lines are built one by one.
  highlightTree(
    src.tree,
    codeHighlighter,
    (start, end, cls) => {
      for (let pos = start; pos < end;) {
        const line = doc.lineAt(pos);
        const stop = Math.min(end, line.to);
        if (stop > pos) out.push({ kind: "mark", from: pos, to: stop, cls });
        pos = line.to + 1;
      }
    },
    Math.max(node.from, from),
    Math.min(node.to, to),
  );
}

/**
 * Handles an inline node. Returns false when the node's children need no handling of their own.
 */
function inline(
  node: SyntaxNodeRef,
  src: Source,
  shown: boolean,
  out: Piece[],
): boolean | undefined {
  switch (node.name) {
    case "Emphasis":
      out.push(mark(node, "sg-em"));
      return;
    case "StrongEmphasis":
      out.push(mark(node, "sg-strong"));
      return;
    case "Strikethrough":
      out.push(mark(node, "sg-strike"));
      return;
    case "InlineCode":
      out.push(mark(node, "sg-code"));
      return;
    case "EmphasisMark":
    case "StrikethroughMark":
    case "CodeMark":
      syntax(node, shown, out);
      return false;
    case "Link":
      link(node.node, src, shown, out);
      return;
    case "Image":
      return image(node.node, src, shown, out);
    case "Autolink":
      for (const child of node.node.getChildren("LinkMark"))
        syntax(child, shown, out);
      return;
    case "URL": {
      const parent = node.node.parent?.name;
      if (parent !== "Link" && parent !== "Image" && parent !== "LinkReference")
        out.push(mark(node, "sg-link"));
      return false;
    }
    case "Escape":
      syntax({ from: node.from, to: node.from + 1 }, shown, out);
      return false;
    case "HardBreak":
      // The node takes in the line break. Only the backslash is marked.
      if (src.doc.sliceString(node.from, node.from + 1) === "\\")
        out.push(mark({ from: node.from, to: node.from + 1 }, "sg-syntax"));
      return false;
    case "HTMLTag":
    case "Comment":
    case "ProcessingInstruction":
      out.push(mark(node, "sg-html"));
      return false;
    default:
      return;
  }
}

function link(node: SyntaxNode, src: Source, shown: boolean, out: Piece[]) {
  const marks = node.getChildren("LinkMark");
  const url = node.getChild("URL");
  const open = marks[0];
  const close = marks[1];
  // A bracketed phrase with neither a destination nor a label is left as text: it is a link only
  // if the document defines a reference by that name, which most bracketed phrases don't have.
  if (!open || !close || !(url || node.getChild("LinkLabel"))) return;
  if (open.to < close.from) {
    const piece: Piece = {
      kind: "mark",
      from: open.to,
      to: close.from,
      cls: "sg-link",
    };
    if (url) piece.attrs = { title: src.doc.sliceString(url.from, url.to) };
    out.push(piece);
  }
  syntax(open, shown, out);
  syntax({ from: close.from, to: node.to }, shown, out);
}

function image(node: SyntaxNode, src: Source, shown: boolean, out: Piece[]) {
  const marks = node.getChildren("LinkMark");
  const url = node.getChild("URL");
  const open = marks[0];
  const close = marks[1];
  if (!open || !close || !url) return;
  const spec: WidgetSpec = {
    type: "image",
    src: src.doc.sliceString(url.from, url.to),
    alt: src.doc.sliceString(open.to, close.from),
  };
  if (shown) {
    // The picture stays below its source while the source is shown, so that the row doesn't
    // collapse to the height of a line of text.
    out.push(mark(node, "sg-syntax"));
    out.push({ kind: "widget", from: node.to, to: node.to, spec });
  } else {
    out.push({ kind: "widget", from: node.from, to: node.to, spec });
  }
  return false;
}

/** The pieces for a table cell's content, with its syntax hidden. */
function cellPieces(cell: SyntaxNode, src: Source): Piece[] {
  const out: Piece[] = [];
  cell.cursor().iterate((node) => {
    if (node.name === "TableCell") return;
    return inline(node, src, false, out);
  });
  return out;
}

/** A rough width for text, for when there is no page to measure it on. */
const estimate: Measure = (text, style) =>
  text.length * (style.code ? 0.55 : 0.5) * (style.bold ? 1.08 : 1);

/**
 * The width a cell's content needs on one row, and the width of its longest word, in ems, with
 * its hidden syntax left out.
 */
function cellWidth(
  cell: Cell,
  header: boolean,
  measure: Measure,
): { width: number; word: number } {
  const bounds = new Set([0, cell.text.length]);
  let width = 0;
  let word = 0;
  for (const piece of cell.pieces) {
    if (piece.kind === "line") continue;
    bounds.add(piece.from).add(piece.to);
    // A picture's size isn't known here, and inline code is padded.
    if (piece.kind === "widget") width += 8;
    else if (piece.kind === "mark" && piece.cls === "sg-code") width += 0.5;
  }
  const stops = [...bounds].sort((a, b) => a - b);
  for (let i = 0; i + 1 < stops.length; i++) {
    const from = stops[i] as number;
    const to = stops[i + 1] as number;
    const style = { bold: header, italic: false, code: false };
    let hidden = false;
    for (const piece of cell.pieces) {
      if (piece.kind === "line" || piece.from > from || piece.to < to) continue;
      if (piece.kind !== "mark") hidden = true;
      else if (piece.cls === "sg-strong") style.bold = true;
      else if (piece.cls === "sg-em") style.italic = true;
      else if (piece.cls === "sg-code") style.code = true;
    }
    if (hidden) continue;
    const text = cell.text.slice(from, to);
    width += measure(text, style);
    for (const part of text.split(/\s+/))
      if (part) word = Math.max(word, measure(part, style));
  }
  return { width, word: Math.min(word, width) };
}

function alignments(delimiter: string): Align[] {
  const cells = delimiter.trim().replace(/^\|/, "").replace(/\|$/, "");
  return cells.split("|").map((cell) => {
    const text = cell.trim();
    if (text.endsWith(":")) return text.startsWith(":") ? "center" : "right";
    return "left";
  });
}

function rowCells(row: SyntaxNode, columns: number, src: Source): Cell[] {
  const cells: Cell[] = [];
  for (let i = 0; i < columns; i++)
    cells.push({ text: "", offset: 0, pieces: [] });
  let column = 0;
  let filled = false;
  for (let child = row.firstChild; child; child = child.nextSibling) {
    if (child.name === "TableDelimiter") {
      if (filled || child.from > row.from) column++;
      filled = false;
    } else if (child.name === "TableCell") {
      filled = true;
      const cell = cells[column];
      if (!cell) continue;
      cell.text = src.doc.sliceString(child.from, child.to);
      cell.offset = child.from - row.from;
      cell.pieces = cellPieces(child, src).map((piece) =>
        shift(piece, -child.from),
      );
    }
  }
  return cells;
}

function shift(piece: Piece, by: number): Piece {
  if (piece.kind === "line") return { ...piece, at: piece.at + by };
  return { ...piece, from: piece.from + by, to: piece.to + by };
}

/**
 * Draws a table a row per source line, its delimiter row included, so that every source line
 * keeps a row of its own to be numbered against.
 */
function table(
  node: SyntaxNode,
  src: Source,
  from: number,
  to: number,
  reveal: Reveal,
  mono: Set<number>,
  out: Piece[],
) {
  const { doc } = src;
  if (reveal(node.from, node.to)) {
    for (let pos = Math.max(node.from, from); pos <= Math.min(node.to, to);) {
      const line = doc.lineAt(pos);
      out.push({ kind: "line", at: line.from, cls: "sg-table-source" });
      mono.add(line.from);
      pos = line.to + 1;
    }
    return;
  }
  const header = node.getChild("TableHeader");
  const delimiter = node.getChild("TableDelimiter");
  if (!header || !delimiter) return;
  const aligns = alignments(doc.sliceString(delimiter.from, delimiter.to));
  const columns = aligns.length;
  const rows: { node: SyntaxNode; kind: "header" | "body"; cells: Cell[] }[] =
    [];
  rows.push({
    node: header,
    kind: "header",
    cells: rowCells(header, columns, src),
  });
  for (const row of node.getChildren("TableRow"))
    rows.push({ node: row, kind: "body", cells: rowCells(row, columns, src) });
  // A column is as wide as its widest cell, up to a limit past which the cell wraps, and is
  // never squeezed narrower than its longest word while there is room. The 1.5em is the cell's
  // padding and a little room for the measurement to be off by.
  const measure = src.measure ?? estimate;
  const widths: number[] = [];
  const floors: number[] = [];
  aligns.forEach((_, column) => {
    let widest = 0.5;
    let longest = 0.5;
    for (const row of rows) {
      const cell = row.cells[column];
      if (!cell?.text) continue;
      const { width, word } = cellWidth(cell, row.kind === "header", measure);
      if (width > widest) widest = width;
      if (word > longest) longest = word;
    }
    const width = Math.min(widest, 32);
    widths.push(Math.round((width + 1.5) * 10) / 10);
    // A very long word is allowed to break, so that one column can't take the whole table.
    floors.push(Math.round((Math.min(longest, width, 6) + 1.5) * 10) / 10);
  });
  const layout = { widths, floors, aligns };
  const visible = (n: SyntaxNode) => n.to >= from && n.from <= to;
  for (const row of rows) {
    if (!visible(row.node)) continue;
    out.push({
      kind: "widget",
      from: row.node.from,
      to: row.node.to,
      spec: { type: "row", kind: row.kind, cells: row.cells, ...layout },
    });
  }
  if (visible(delimiter))
    out.push({
      kind: "widget",
      from: delimiter.from,
      to: delimiter.to,
      spec: { type: "row", kind: "delimiter", cells: [], ...layout },
    });
}

const glyphs: Record<string, string> = { "*": "•", "-": "–", "+": "+" };

/**
 * Lays out what comes before each line's content: quote marks, indentation and list markers.
 * Each goes in a box of fixed width, and the line is padded so that wrapped rows hang under the
 * content's first row. The boxes are the same whether or not the line's syntax is shown, so
 * moving the cursor onto a list item or into a quote doesn't move its text.
 */
function prefixes(
  src: Source,
  first: Line,
  last: Line,
  reveal: Reveal,
  mono: Set<number>,
  out: Piece[],
) {
  const { doc } = src;
  const items = new Map<number, Item | null>();
  for (let n = first.number; n <= last.number; n++) {
    const line = doc.line(n);
    // Monospaced lines carry the font on their content, for the reason headings do.
    const monospace = (from: number) => {
      if (from < line.to)
        out.push({ kind: "mark", from, to: line.to, cls: "sg-mono" });
    };
    if (line.from < src.frontMatterTo) {
      out.push({ kind: "line", at: line.from, cls: "sg-front-matter" });
      monospace(line.from);
      continue;
    }
    const prefix = linePrefix(doc, src.tree, line, items);
    if (!prefix.chain.length) {
      if (mono.has(line.from)) monospace(line.from);
      continue;
    }
    const shown = reveal(line.from, line.to);
    let boxes = 0;
    for (const token of prefix.tokens) {
      switch (token.type) {
        case "indent":
          boxes += token.levels * INDENT;
          out.push({
            kind: "mark",
            from: token.from,
            to: token.to,
            cls: "sg-box",
            attrs: { style: `width: ${round(token.levels * INDENT)}em` },
          });
          break;
        case "quote":
          boxes += QUOTE;
          out.push({
            kind: "mark",
            from: token.from,
            to: token.to,
            cls: shown
              ? "sg-box sg-quote sg-syntax"
              : "sg-box sg-quote sg-unseen",
          });
          break;
        case "bar":
          boxes += QUOTE;
          out.push({
            kind: "widget",
            from: token.from,
            to: token.to,
            spec: { type: "bar" },
          });
          break;
        case "marker": {
          boxes += INDENT;
          const { item } = token;
          if (item.ordered || shown) {
            out.push({
              kind: "mark",
              from: token.from,
              to: token.to,
              cls: item.ordered
                ? "sg-box sg-marker sg-ordered"
                : "sg-box sg-marker",
            });
          } else {
            // A bullet's glyph takes the place of the whole box, marker and space, because a
            // widget that replaced only the marker would be drawn outside the box.
            out.push({
              kind: "widget",
              from: token.from,
              to: token.to,
              spec: {
                type: "bullet",
                glyph: item.task ? "" : (glyphs[item.marker] ?? item.marker),
              },
            });
          }
          break;
        }
      }
    }
    if (mono.has(line.from)) monospace(prefix.contentFrom);
    const pad = prefix.lists * INDENT + prefix.quotes * QUOTE;
    out.push({
      kind: "line",
      at: line.from,
      cls: "sg-nested",
      style: `padding-left: calc(var(--sg-pad) + ${round(pad)}em); text-indent: -${round(boxes)}em`,
    });
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
