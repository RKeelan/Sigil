import {
  buildPieces,
  type Cell,
  type Piece,
  type Source,
  type WidgetSpec,
} from "./pieces.ts";

type Mark = Extract<Piece, { kind: "mark" }>;
type Widget = Extract<Piece, { kind: "widget" }>;

/** A class to lay over a range of rendered text, on top of whatever the text's own marks are. */
export interface Tint {
  from: number;
  to: number;
  cls: string;
}

function element(doc: Document, tag: string, cls: string): HTMLElement {
  const dom = doc.createElement(tag);
  dom.className = cls;
  return dom;
}

/** Builds the DOM that stands in for a piece of source text. */
export function widgetDOM(spec: WidgetSpec, doc: Document): HTMLElement {
  switch (spec.type) {
    case "bullet": {
      // The box a list marker goes in, holding a glyph and a space where the source has a
      // marker and a space.
      const dom = element(doc, "span", "sg-box sg-marker sg-bullet");
      dom.textContent = `${spec.glyph} `;
      dom.setAttribute("aria-hidden", "true");
      return dom;
    }
    case "task": {
      const dom = element(doc, "span", "sg-task");
      dom.setAttribute("role", "checkbox");
      dom.setAttribute("aria-checked", String(spec.checked));
      if (spec.checked) dom.classList.add("sg-task-checked");
      return dom;
    }
    case "image": {
      const dom = doc.createElement("img");
      dom.className = "sg-image";
      dom.alt = spec.alt;
      dom.title = spec.alt;
      dom.src = spec.src;
      return dom;
    }
    case "rule":
      return element(doc, "span", "sg-rule");
    case "bar":
      return element(doc, "span", "sg-box sg-quote");
    case "row":
      return rowDOM(spec, doc);
  }
}

function rowDOM(
  spec: Extract<WidgetSpec, { type: "row" }>,
  doc: Document,
): HTMLElement {
  const dom = element(doc, "span", `sg-row sg-row-${spec.kind}`);
  const total = spec.widths.reduce((sum, width) => sum + width, 0);
  // Columns share whatever width there is in proportion to what they need, and none is made
  // narrower than its longest word, so that a squeezed table wraps between words. When even the
  // longest words don't fit, the columns take shares of the width in proportion to them, so
  // that the table still fits.
  const floor = spec.floors.reduce((sum, width) => sum + width, 0);
  dom.style.gridTemplateColumns = spec.widths
    .map((width, column) => {
      const least = spec.floors[column] ?? width;
      const share = Math.floor((1000 * least) / floor) / 10;
      return `minmax(min(${least}em, ${share}%), ${width}fr)`;
    })
    .join(" ");
  dom.style.width = `min(100%, ${Math.round(total * 10) / 10}em)`;
  spec.widths.forEach((_, column) => {
    const cell = element(doc, "span", "sg-cell");
    cell.style.textAlign = spec.aligns[column] ?? "left";
    const content: Cell | undefined = spec.cells[column];
    if (content) {
      cell.dataset.offset = String(content.offset);
      cell.append(renderInline(content.text, 0, content.pieces, [], doc));
    }
    dom.append(cell);
  });
  return dom;
}

/**
 * Renders a stretch of source text as DOM. `base` is the position `text` starts at, in the
 * coordinates the pieces and tints are in.
 */
export function renderInline(
  text: string,
  base: number,
  pieces: readonly Piece[],
  tints: readonly Tint[],
  doc: Document,
): DocumentFragment {
  const end = base + text.length;
  const marks: Mark[] = [];
  const gaps: { from: number; to: number }[] = [];
  const widgets: Widget[] = [];
  for (const piece of pieces) {
    if (piece.kind === "line" || piece.to < base || piece.from > end) continue;
    if (piece.kind === "mark") marks.push(piece);
    else {
      if (piece.to > piece.from) gaps.push(piece);
      if (piece.kind === "widget") widgets.push(piece);
    }
  }
  marks.sort((a, b) => a.from - b.from || b.to - a.to);
  gaps.sort((a, b) => a.from - b.from);
  widgets.sort((a, b) => a.from - b.from);
  let gap = 0;
  let widget = 0;

  // Appends the widgets that sit at a position without replacing any text.
  const inserted = (parent: Node, at: number) => {
    for (;;) {
      const next = widgets[widget];
      if (!next || next.from !== at || next.to !== at) return;
      parent.appendChild(widgetDOM(next.spec, doc));
      widget++;
    }
  };

  // Appends the text between two positions, less whatever is hidden, with its tints.
  const plain = (parent: Node, from: number, to: number) => {
    let pos = from;
    while (pos < to) {
      const next = widgets[widget];
      if (next && next.from === pos) {
        parent.appendChild(widgetDOM(next.spec, doc));
        widget++;
        continue;
      }
      while ((gaps[gap]?.to ?? Infinity) <= pos) gap++;
      const hidden = gaps[gap];
      if (hidden && hidden.from <= pos) {
        pos = Math.min(hidden.to, to);
        continue;
      }
      let stop = Math.min(to, hidden?.from ?? to, next?.from ?? to);
      let cls = "";
      for (const tint of tints) {
        if (tint.from <= pos && tint.to > pos) {
          cls += cls ? ` ${tint.cls}` : tint.cls;
          stop = Math.min(stop, tint.to);
        } else if (tint.from > pos) {
          stop = Math.min(stop, tint.from);
        }
      }
      const node = doc.createTextNode(text.slice(pos - base, stop - base));
      if (cls) {
        const span = element(doc, "span", cls);
        span.appendChild(node);
        parent.appendChild(span);
      } else {
        parent.appendChild(node);
      }
      pos = stop;
    }
  };

  let index = 0;
  const build = (parent: Node, from: number, to: number) => {
    let pos = from;
    while (index < marks.length) {
      const mark = marks[index] as Mark;
      if (mark.from >= to) break;
      index++;
      const start = Math.max(mark.from, pos);
      const stop = Math.min(mark.to, to);
      if (stop <= start) continue;
      plain(parent, pos, start);
      inserted(parent, start);
      const span = element(doc, "span", mark.cls);
      if (mark.attrs)
        for (const [name, value] of Object.entries(mark.attrs)) {
          if (name === "style") span.style.cssText = value;
          else span.setAttribute(name, value);
        }
      build(span, start, stop);
      parent.appendChild(span);
      pos = stop;
    }
    plain(parent, pos, to);
  };

  const fragment = doc.createDocumentFragment();
  build(fragment, base, end);
  inserted(fragment, end);
  return fragment;
}

/**
 * Renders whole lines of a text the way the editor would draw them with no syntax shown: one
 * element per source line, numbered from `fromLine` to `toLine` inclusive.
 */
export function renderLines(
  src: Source,
  fromLine: number,
  toLine: number,
  tints: readonly Tint[],
  doc: Document,
): HTMLElement[] {
  const first = src.doc.line(fromLine);
  const last = src.doc.line(toLine);
  const pieces = buildPieces(src, first.from, last.to);
  const lines: HTMLElement[] = [];
  for (let n = fromLine; n <= toLine; n++) {
    const line = src.doc.line(n);
    const dom = element(doc, "div", "sg-line");
    for (const piece of pieces) {
      if (piece.kind !== "line" || piece.at !== line.from) continue;
      dom.className += ` ${piece.cls}`;
      if (piece.style) dom.style.cssText = piece.style;
    }
    const inside = pieces.filter(
      (piece) =>
        piece.kind !== "line" && piece.from >= line.from && piece.to <= line.to,
    );
    dom.append(renderInline(line.text, line.from, inside, tints, doc));
    // A line with nothing in it that has a size, such as a blank line or a fence whose marks
    // are hidden, is given a break so that it still takes up a row.
    if (
      !dom.textContent &&
      !dom.querySelector("img, .sg-rule, .sg-row, .sg-task")
    )
      dom.append(doc.createElement("br"));
    lines.push(dom);
  }
  return lines;
}
