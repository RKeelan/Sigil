import { syntaxTree } from "@codemirror/language";
import {
  type ChangeSpec,
  EditorSelection,
  type EditorState,
  type Line,
  type SelectionRange,
  type StateCommand,
} from "@codemirror/state";
import type { SyntaxNode, Tree } from "@lezer/common";
import { frontMatterEnd } from "../markdown/parser.ts";
import {
  columnAt,
  type Item,
  itemInfo,
  linePrefix,
  type Prefix,
} from "../markdown/structure.ts";

interface Edit {
  changes: ChangeSpec;
  /** Where the cursor goes, as a position in the document after the changes. */
  cursor?: number;
}

/** Blocks whose lines Enter doesn't continue. */
const verbatim = /^(FencedCode|CodeBlock|Table|HTMLBlock|CommentBlock)$/;

/** The text that continues a line's quotes: its prefix with list markers blanked out. */
function quotePrefix(line: Line, prefix: Prefix, to: number): string {
  let text = line.text.slice(0, to - line.from);
  for (const token of prefix.tokens) {
    if (token.type !== "marker" || token.from >= to) continue;
    const from = token.from - line.from;
    const end = Math.min(token.to, to) - line.from;
    text = text.slice(0, from) + " ".repeat(end - from) + text.slice(end);
  }
  return text;
}

/** The marker of the item after one: the same bullet, or the next number. */
function nextMarker(item: Item): string {
  const numbered = /^(\d+)([.)])$/.exec(item.marker);
  if (!numbered) return item.marker;
  return `${Number(numbered[1]) + 1}${numbered[2] as string}`;
}

/** The item whose first paragraph holds a position, when the position is in one. */
function itemAround(
  state: EditorState,
  tree: Tree,
  pos: number,
  line: Line,
  prefix: Prefix,
): Item | null {
  const marker = prefix.tokens.findLast((token) => token.type === "marker");
  const innermost = prefix.chain[prefix.chain.length - 1];
  if (marker?.type === "marker")
    return innermost?.name === "ListItem" ? marker.item : null;
  if (innermost?.name !== "ListItem") return null;
  const item = itemInfo(innermost, state.doc);
  if (!item) return null;
  // Only the paragraph that starts on the marker's line continues into a new item. Enter in a
  // later paragraph of the item, or in a block nested in it, starts another line of that block.
  // The block is found the way `containersOf` finds containers, so that `innermost` is among its
  // ancestors as the same object.
  let block: SyntaxNode | null = tree.resolve(
    line.from + line.text.trimEnd().length,
    -1,
  );
  while (block && block.parent !== innermost) block = block.parent;
  if (!block || state.doc.lineAt(block.from).from !== item.line) return null;
  return pos >= block.from && pos <= block.to ? item : null;
}

function continueItem(
  state: EditorState,
  tree: Tree,
  pos: number,
  item: Item,
): Edit | null {
  const { doc } = state;
  const first = doc.lineAt(item.line);
  const prefix = linePrefix(doc, tree, first);
  const contentFrom = item.task
    ? Math.min(
        first.to,
        item.task.to +
          (/[ \t]/.test(doc.sliceString(item.task.to, item.task.to + 1))
            ? 1
            : 0),
      )
    : item.contentFrom;
  if (pos < contentFrom) return null;
  const empty =
    doc.sliceString(contentFrom, first.to).trim() === "" &&
    item.node.to <= first.to;
  if (empty) {
    if (prefix.lists > 1) return outdent(state, tree, [item]);
    // An empty item that isn't nested loses its marker, which ends the list.
    let from = first.from;
    for (const token of prefix.tokens)
      if (token.type === "quote" && token.to <= item.markFrom) from = token.to;
    return { changes: { from, to: first.to }, cursor: from };
  }
  const gap = doc.sliceString(item.markTo, item.contentFrom) || " ";
  const insert =
    state.lineBreak +
    quotePrefix(first, prefix, item.markFrom) +
    nextMarker(item) +
    gap +
    (item.task ? "[ ] " : "");
  const line = doc.lineAt(pos);
  let to = pos;
  while (to < line.to && /[ \t]/.test(line.text[to - line.from] as string))
    to++;
  return { changes: { from: pos, to, insert }, cursor: pos + insert.length };
}

function continueQuote(
  state: EditorState,
  pos: number,
  line: Line,
  prefix: Prefix,
): Edit | null {
  const { doc } = state;
  const quote = prefix.tokens.findLast((token) => token.type === "quote");
  if (!quote || pos < prefix.contentFrom) return null;
  const empty = doc.sliceString(prefix.contentFrom, line.to).trim() === "";
  if (empty && line.number > 1) {
    // Two empty quoted lines in a row end the quote; one is a break between its paragraphs.
    const above = doc.line(line.number - 1);
    const column = quote.from - line.from;
    if (/^>[ \t]*$/.test(above.text.slice(column))) {
      return {
        changes: [
          { from: above.from + column, to: above.to },
          { from: quote.from, to: line.to },
        ],
      };
    }
  }
  const insert =
    state.lineBreak + quotePrefix(line, prefix, prefix.contentFrom);
  return { changes: { from: pos, insert }, cursor: pos + insert.length };
}

function continuation(state: EditorState, pos: number): Edit | null {
  const { doc } = state;
  if (pos < frontMatterEnd(doc)) return null;
  const tree = syntaxTree(state);
  for (
    let node: SyntaxNode | null = tree.resolveInner(pos, -1);
    node;
    node = node.parent
  )
    if (verbatim.test(node.name)) return null;
  const line = doc.lineAt(pos);
  const prefix = linePrefix(doc, tree, line);
  const innermost = prefix.chain[prefix.chain.length - 1];
  if (!innermost) return null;
  const item = itemAround(state, tree, pos, line, prefix);
  if (item) return continueItem(state, tree, pos, item);
  if (innermost.name === "Blockquote")
    return continueQuote(state, pos, line, prefix);
  return null;
}

/**
 * Enter in a list item or quote starts the next one: the same bullet or the next number, an open
 * task, and the item's indentation and quote marks. Enter in an empty item outdents it, or takes
 * its marker away when it isn't nested. Other items are left as they are, numbers included.
 */
export const continueMarkup: StateCommand = ({ state, dispatch }) => {
  let handled = true;
  const spec = state.changeByRange((range) => {
    const edit = range.empty ? continuation(state, range.head) : null;
    if (!edit) {
      handled = false;
      return { range };
    }
    return {
      changes: edit.changes,
      range:
        edit.cursor === undefined
          ? range.map(state.changes(edit.changes))
          : EditorSelection.cursor(edit.cursor),
    };
  });
  if (!handled) return false;
  dispatch(state.update(spec, { scrollIntoView: true, userEvent: "input" }));
  return true;
};

/** The whitespace a line has where an item's own indentation goes: after any outer quote marks. */
function indentAt(prefix: Prefix, line: Line, outerQuotes: number): number {
  let at = line.from;
  let seen = 0;
  for (const token of prefix.tokens) {
    if (token.type !== "quote" || seen >= outerQuotes) continue;
    seen++;
    at = token.to;
  }
  return at;
}

/** How many of the containers around an item are quotes written with `>`. */
function quotesAround(item: Item): number {
  let count = 0;
  for (let node = item.node.parent; node; node = node.parent)
    if (node.name === "Blockquote") count++;
  return count;
}

/** The lines of an item, its marker line first. */
function itemLines(state: EditorState, item: Item): Line[] {
  const lines: Line[] = [];
  const last = state.doc.lineAt(item.node.to).number;
  for (let n = state.doc.lineAt(item.line).number; n <= last; n++)
    lines.push(state.doc.line(n));
  return lines;
}

/** Moves items, with everything in them, `columns` to the right. */
function shiftRight(
  state: EditorState,
  tree: Tree,
  item: Item,
  columns: number,
): ChangeSpec[] {
  const changes: ChangeSpec[] = [];
  const quotes = quotesAround(item);
  const insert = " ".repeat(columns);
  for (const line of itemLines(state, item)) {
    if (line.from === item.line) {
      changes.push({ from: item.markFrom, insert });
    } else if (line.text.trim()) {
      const prefix = linePrefix(state.doc, tree, line);
      changes.push({ from: indentAt(prefix, line, quotes), insert });
    }
  }
  return changes;
}

/** Moves an item, with everything in it, up to `columns` to the left. */
function shiftLeft(
  state: EditorState,
  tree: Tree,
  item: Item,
  columns: number,
): ChangeSpec[] {
  const changes: ChangeSpec[] = [];
  const quotes = quotesAround(item);
  for (const line of itemLines(state, item)) {
    if (!line.text.trim()) continue;
    const prefix = linePrefix(state.doc, tree, line);
    const from = indentAt(prefix, line, quotes);
    let to = from;
    const start = columnAt(line.text, from - line.from);
    while (
      to < line.to &&
      /[ \t]/.test(line.text[to - line.from] as string) &&
      columnAt(line.text, to + 1 - line.from) - start <= columns
    )
      to++;
    if (line.from === item.line) to = Math.min(to, item.markFrom);
    if (to > from) changes.push({ from, to });
  }
  return changes;
}

function parentItem(state: EditorState, item: Item): Item | null {
  const parent = item.node.parent?.parent;
  return parent?.name === "ListItem" ? itemInfo(parent, state.doc) : null;
}

function outdent(state: EditorState, tree: Tree, items: Item[]): Edit | null {
  const changes: ChangeSpec[] = [];
  for (const item of items) {
    const parent = parentItem(state, item);
    if (!parent) continue;
    const columns = item.markColumn - parent.markColumn;
    if (columns > 0) changes.push(...shiftLeft(state, tree, item, columns));
  }
  return changes.length ? { changes } : null;
}

/** The item before one in its list. Inside a quote, the lines' `>` marks sit between items. */
function itemAbove(item: Item): SyntaxNode | null {
  let node = item.node.prevSibling;
  while (node && node.name !== "ListItem") node = node.prevSibling;
  return node;
}

function nest(state: EditorState, tree: Tree, items: Item[]): Edit | null {
  const changes: ChangeSpec[] = [];
  // Items nested together move by the same amount, so that they stay siblings of one another
  // under the item above them.
  const moved = new Map<number, number>();
  for (const item of items) {
    const above = itemAbove(item);
    if (!above) continue;
    let columns = moved.get(above.from);
    if (columns === undefined) {
      const sibling = itemInfo(above, state.doc);
      if (!sibling) continue;
      columns = sibling.column - item.markColumn;
    }
    if (columns <= 0) continue;
    moved.set(item.node.from, columns);
    changes.push(...shiftRight(state, tree, item, columns));
  }
  return changes.length ? { changes } : null;
}

/**
 * The items whose markers are on the lines a range touches, leaving out those inside another
 * item in the range, which moves with it.
 */
function itemsIn(
  state: EditorState,
  tree: Tree,
  range: SelectionRange,
): Item[] {
  const { doc } = state;
  const items: Item[] = [];
  const first = doc.lineAt(range.from).number;
  const end = doc.lineAt(range.to);
  // A selection that ends at the start of a line doesn't take that line in.
  const last = end.from === range.to ? end.number - 1 : end.number;
  let coveredTo = -1;
  for (let n = first; n <= last; n++) {
    const line = doc.line(n);
    const prefix = linePrefix(doc, tree, line);
    for (const token of prefix.tokens) {
      if (token.type !== "marker" || token.item.markFrom <= coveredTo) continue;
      items.push(token.item);
      coveredTo = token.item.node.to;
    }
  }
  return items;
}

/** The item a cursor is right after the marker of. */
function itemAtMarker(
  state: EditorState,
  tree: Tree,
  pos: number,
): Item | null {
  const line = state.doc.lineAt(pos);
  const prefix = linePrefix(state.doc, tree, line);
  const marker = prefix.tokens.findLast((token) => token.type === "marker");
  if (marker?.type !== "marker") return null;
  const { item } = marker;
  if (pos === item.contentFrom || pos === item.markTo) return item;
  if (!item.task || pos < item.task.to) return null;
  return /^[ \t]?$/.test(state.doc.sliceString(item.task.to, pos))
    ? item
    : null;
}

function spansLines(state: EditorState, range: SelectionRange): boolean {
  return (
    !range.empty &&
    state.doc.lineAt(range.from).number !== state.doc.lineAt(range.to).number
  );
}

/**
 * Tab right after a list item's marker nests the item under the item above it, at that item's
 * content column. With a selection across lines it nests every item in the selection. Anywhere
 * else it types a tab.
 */
export const nestItem: StateCommand = ({ state, dispatch }) => {
  const tree = syntaxTree(state);
  const items: Item[] = [];
  let lists = false;
  for (const range of state.selection.ranges) {
    if (spansLines(state, range)) {
      const found = itemsIn(state, tree, range);
      if (found.length) lists = true;
      items.push(...found);
    } else if (range.empty) {
      const item = itemAtMarker(state, tree, range.head);
      if (item && itemAbove(item)) {
        lists = true;
        items.push(item);
      }
    }
  }
  if (!lists) {
    dispatch(
      state.update(state.replaceSelection("\t"), {
        scrollIntoView: true,
        userEvent: "input.type",
      }),
    );
    return true;
  }
  const edit = nest(state, tree, distinct(items));
  if (edit)
    dispatch(
      state.update({
        changes: edit.changes,
        scrollIntoView: true,
        userEvent: "input.indent",
      }),
    );
  return true;
};

/**
 * Shift+Tab on a list item's marker line moves the item out a level, to where the item it is
 * nested in starts. With a selection across lines it outdents every item in the selection.
 */
export const outdentItem: StateCommand = ({ state, dispatch }) => {
  const tree = syntaxTree(state);
  const items: Item[] = [];
  for (const range of state.selection.ranges) {
    if (spansLines(state, range)) {
      items.push(...itemsIn(state, tree, range));
      continue;
    }
    const line = state.doc.lineAt(range.head);
    const prefix = linePrefix(state.doc, tree, line);
    const marker = prefix.tokens.findLast((token) => token.type === "marker");
    if (marker?.type === "marker") items.push(marker.item);
  }
  const edit = outdent(state, tree, distinct(items));
  if (edit)
    dispatch(
      state.update({
        changes: edit.changes,
        scrollIntoView: true,
        userEvent: "delete.dedent",
      }),
    );
  return true;
};

function distinct(items: Item[]): Item[] {
  const seen = new Set<number>();
  return items.filter((item) => {
    if (seen.has(item.markFrom)) return false;
    seen.add(item.markFrom);
    return true;
  });
}
