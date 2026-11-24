import type { Line, Text } from "@codemirror/state";
import type { SyntaxNode, Tree } from "@lezer/common";

/** A list item, described by the line its marker is on. */
export interface Item {
  node: SyntaxNode;
  /** The start of the line holding the marker. */
  line: number;
  markFrom: number;
  markTo: number;
  /** The start of the item's content: the end of the marker and the space after it. */
  contentFrom: number;
  /** The column the marker starts at. */
  markColumn: number;
  /** The column the item's content starts at, which is where text nested in the item lines up. */
  column: number;
  ordered: boolean;
  marker: string;
  /** The task box, when the item is a task. */
  task: SyntaxNode | null;
}

/** One part of what comes before a line's content. */
export type PrefixToken =
  /** Indentation that puts the line inside `levels` enclosing list items. */
  | { type: "indent"; from: number; to: number; levels: number }
  /** A `>` and the space after it. */
  | { type: "quote"; from: number; to: number }
  /** The edge of a fenced quote, which takes up no source text. */
  | { type: "bar"; from: number; to: number }
  /** A list marker and the space after it. */
  | { type: "marker"; from: number; to: number; item: Item };

export interface Prefix {
  /** The quotes and list items the line is inside, outermost first. */
  chain: SyntaxNode[];
  tokens: PrefixToken[];
  /** How many of the containers are list items, and how many are quotes. */
  lists: number;
  quotes: number;
  /** Where the line's content starts. */
  contentFrom: number;
}

/** The column a position in a line is at, with tab stops four columns apart. */
export function columnAt(text: string, to: number): number {
  let col = 0;
  for (let i = 0; i < to; i++)
    col = text[i] === "\t" ? col + 4 - (col % 4) : col + 1;
  return col;
}

export function itemInfo(node: SyntaxNode, doc: Text): Item | null {
  const listMark = node.firstChild;
  if (listMark?.name !== "ListMark") return null;
  const line = doc.lineAt(node.from);
  const rest = line.text.slice(listMark.to - line.from);
  const space = (/^[ \t]*/.exec(rest) as RegExpExecArray)[0].length;
  const empty = space === rest.length;
  // Five or more spaces after a marker start an indented code block one space in.
  const contentFrom = listMark.to + (empty || space <= 4 ? space : 1);
  const next = listMark.nextSibling;
  return {
    node,
    line: line.from,
    markFrom: listMark.from,
    markTo: listMark.to,
    contentFrom,
    markColumn: columnAt(line.text, listMark.from - line.from),
    column: empty
      ? columnAt(line.text, listMark.to - line.from) + 1
      : columnAt(line.text, contentFrom - line.from),
    ordered: node.parent?.name === "OrderedList",
    marker: doc.sliceString(listMark.from, listMark.to),
    task: next?.name === "Task" ? next.firstChild : null,
  };
}

const containers = new Set(["Blockquote", "FencedQuote", "ListItem"]);

/**
 * The quotes and list items a line is inside, outermost first. The tree mounted over a fenced
 * block's code isn't entered, so that Markdown in a fenced block adds none.
 */
export function containersOf(tree: Tree, line: Line): SyntaxNode[] {
  const length = line.text.trimEnd().length;
  let node: SyntaxNode | null = length
    ? tree.resolve(line.from + length, -1)
    : tree.resolve(line.from, 0);
  const chain: SyntaxNode[] = [];
  for (; node; node = node.parent)
    if (containers.has(node.name)) chain.push(node);
  return chain.reverse();
}

/**
 * Splits what comes before a line's content into the marks and indentation of the quotes and
 * list items the line is inside. `items` caches list items by position across calls.
 */
export function linePrefix(
  doc: Text,
  tree: Tree,
  line: Line,
  items?: Map<number, Item | null>,
): Prefix {
  const chain = containersOf(tree, line);
  const tokens: PrefixToken[] = [];
  const text = line.text;
  let pos = 0;
  let lists = 0;
  let quotes = 0;
  // A line that stops short of the indentation or marks it is due is a lazy continuation of a
  // paragraph, and has nothing more before its content.
  let lazy = false;
  let pending = 0;
  let pendingColumn = 0;
  const indent = () => {
    if (!pending) return;
    let end = pos;
    let col = columnAt(text, pos);
    while (end < text.length && col < pendingColumn) {
      const ch = text[end];
      if (ch === " ") col++;
      else if (ch === "\t") col += 4 - (col % 4);
      else break;
      end++;
    }
    if (end > pos) {
      tokens.push({
        type: "indent",
        from: line.from + pos,
        to: line.from + end,
        levels: pending,
      });
      pos = end;
    } else {
      lazy = true;
    }
    pending = 0;
  };
  for (const node of chain) {
    if (node.name === "ListItem") {
      let item = items?.get(node.from);
      if (item === undefined) {
        item = itemInfo(node, doc);
        items?.set(node.from, item);
      }
      if (!item) continue;
      lists++;
      if (lazy) continue;
      if (item.line !== line.from) {
        pending++;
        pendingColumn = item.column;
        continue;
      }
      if (pending) {
        pendingColumn = item.markColumn;
        indent();
        lazy = false;
      }
      const to = Math.max(item.contentFrom, item.markTo);
      tokens.push({ type: "marker", from: item.markFrom, to, item });
      pos = to - line.from;
      continue;
    }
    quotes++;
    if (lazy) continue;
    indent();
    if (lazy) continue;
    if (node.name === "FencedQuote") {
      tokens.push({ type: "bar", from: line.from + pos, to: line.from + pos });
      continue;
    }
    let at = pos;
    while (at < text.length && at - pos < 3 && text[at] === " ") at++;
    if (text[at] !== ">") {
      lazy = true;
      continue;
    }
    const end = text[at + 1] === " " || text[at + 1] === "\t" ? at + 2 : at + 1;
    tokens.push({ type: "quote", from: line.from + at, to: line.from + end });
    pos = end;
  }
  if (!lazy) indent();
  return { chain, tokens, lists, quotes, contentFrom: line.from + pos };
}
