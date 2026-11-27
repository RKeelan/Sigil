import { syntaxTree } from "@codemirror/language";
import {
  EditorSelection,
  EditorState,
  type Extension,
  Facet,
  type Line,
  Prec,
  type SelectionRange,
  StateField,
  type Text,
  type Transaction,
  type TransactionSpec,
} from "@codemirror/state";
import {
  type Command,
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
} from "@codemirror/view";
import type { SyntaxNode, Tree } from "@lezer/common";
import { frontMatterEnd } from "../markdown/parser.ts";
import { revealed, type Span } from "./reveal.ts";

/**
 * A line that holds nothing but syntax, and the construct it belongs to, which shows it when the
 * construct's source is shown.
 */
export interface SyntaxLine {
  /** The start of the line. */
  from: number;
  /** The end of the line, before its line break. */
  to: number;
  /** The construct the line belongs to. */
  block: Span;
}

/**
 * Reasons to keep a line of syntax in view whatever the cursor does, such as a change on it that
 * is waiting to be reviewed. Each is given the line's number.
 */
export const keepLineShown =
  Facet.define<(state: EditorState, line: number) => boolean>();

/** Whether the text on a line before `at` is only indentation and quote marks. */
function bareBefore(line: Line, at: number): boolean {
  return /^[\s>]*$/.test(line.text.slice(0, at - line.from));
}

/** Whether the text on a line after `at` is only white space. */
function bareAfter(line: Line, at: number): boolean {
  return /^\s*$/.test(line.text.slice(at - line.from));
}

function fenceLines(node: SyntaxNode, doc: Text, out: SyntaxLine[]) {
  const block = { from: node.from, to: node.to };
  const open = node.firstChild;
  const close = node.lastChild;
  if (open?.name !== "CodeMark") return;
  const first = doc.lineAt(open.from);
  const last = close && close !== open ? doc.lineAt(close.from) : null;
  const closed =
    close?.name === "CodeMark" &&
    last !== null &&
    last.number > first.number &&
    bareBefore(last, close.from) &&
    bareAfter(last, close.to);
  // An opening fence that names a language keeps its row, which shows the language. One that
  // names none is as empty as the closing fence, but is kept when the block has no code, so that
  // an empty block still takes up a row.
  const end = closed ? last.number : doc.lineAt(node.to).number + 1;
  if (
    !node.getChild("CodeInfo") &&
    end > first.number + 1 &&
    bareBefore(first, open.from) &&
    bareAfter(first, open.to)
  )
    out.push({ from: first.from, to: first.to, block });
  if (closed) out.push({ from: last.from, to: last.to, block });
}

function underline(node: SyntaxNode, doc: Text, out: SyntaxLine[]) {
  const mark = node.lastChild;
  if (mark?.name !== "HeaderMark") return;
  const line = doc.lineAt(mark.from);
  if (line.from <= node.from) return;
  if (bareBefore(line, mark.from) && bareAfter(line, mark.to))
    out.push({
      from: line.from,
      to: line.to,
      block: { from: node.from, to: node.to },
    });
}

/** Blocks that can't hold a fenced block or a setext heading. */
const leaves =
  /^(Paragraph|ATXHeading\d|Table|CodeBlock|HTMLBlock|CommentBlock|ProcessingInstructionBlock|LinkReference|HorizontalRule)$/;

/**
 * The lines in a document that hold nothing but syntax: the closing fence of a fenced block, its
 * opening fence when that names no language, and the underline of a setext heading.
 */
export function syntaxLinesIn(doc: Text, tree: Tree): SyntaxLine[] {
  const out: SyntaxLine[] = [];
  const frontMatterTo = frontMatterEnd(doc);
  tree.iterate({
    enter(node) {
      if (node.name === "Document") return;
      if (node.from < frontMatterTo) return false;
      if (node.name === "FencedCode") fenceLines(node.node, doc, out);
      else if (/^SetextHeading\d$/.test(node.name))
        underline(node.node, doc, out);
      else return !leaves.test(node.name);
      return false;
    },
  });
  return out;
}

interface Hidden {
  doc: Text;
  tree: Tree;
  /** Every line of syntax in the document. */
  candidates: readonly SyntaxLine[];
  /** The lines of syntax left out of the view. */
  lines: readonly SyntaxLine[];
  decorations: DecorationSet;
}

function hiddenOf(
  state: EditorState,
  candidates: readonly SyntaxLine[],
): SyntaxLine[] {
  const { spans } = state.field(revealed);
  const keep = state.facet(keepLineShown);
  return candidates.filter(
    (line) =>
      !spans.some(
        (span) => span.from <= line.block.to && span.to >= line.block.from,
      ) &&
      !keep.some((reason) => reason(state, state.doc.lineAt(line.from).number)),
  );
}

function sameLines(a: readonly SyntaxLine[], b: readonly SyntaxLine[]) {
  return (
    a.length === b.length &&
    a.every((line, i) => line.from === b[i]?.from && line.to === b[i]?.to)
  );
}

function hide(state: EditorState, previous?: Hidden): Hidden {
  const { doc } = state;
  const tree = syntaxTree(state);
  const candidates =
    previous?.doc === doc && previous.tree === tree
      ? previous.candidates
      : syntaxLinesIn(doc, tree);
  const lines = hiddenOf(state, candidates);
  if (previous && sameLines(previous.lines, lines))
    return previous.candidates === candidates
      ? previous
      : { ...previous, doc, tree, candidates, lines };
  return {
    doc,
    tree,
    candidates,
    lines,
    decorations: Decoration.set(
      lines.map((line) =>
        Decoration.replace({ block: true }).range(line.from, line.to),
      ),
    ),
  };
}

/**
 * The lines of syntax left out of the view. Leaving out a line changes the view's height, so the
 * decorations have to come from the state and not from a view plugin.
 */
const hidden = StateField.define<Hidden>({
  create: (state) => hide(state),
  update: (value, tr) => hide(tr.state, value),
  provide: (field) =>
    EditorView.decorations.from(field, (value) => value.decorations),
});

/** The lines of syntax left out of the view. */
export function hiddenLines(state: EditorState): readonly SyntaxLine[] {
  return state.field(hidden, false)?.lines ?? [];
}

/**
 * Where the cursor goes when it moves onto a hidden line: the end of the line's syntax when it
 * comes from below, and the start when it comes from above. Both are in the line's construct, so
 * the cursor there shows the line in either reveal scope.
 */
export function entryPoint(line: SyntaxLine, fromBelow: boolean): number {
  return fromBelow
    ? Math.min(line.to, line.block.to)
    : Math.max(line.from, line.block.from);
}

/**
 * Where a vertical move from `range` should stop instead of `moved`, where it would otherwise
 * go: on the nearest hidden line it would pass, with the goal column it had, so that the next
 * move goes on from the column it started at. Null if it passes no hidden line.
 */
export function stopOnHidden(
  state: EditorState,
  range: SelectionRange,
  moved: SelectionRange,
  forward: boolean,
  extend: boolean,
): SelectionRange | null {
  const { doc } = state;
  const start = doc.lineAt(range.head).number;
  const end = doc.lineAt(moved.head).number;
  const passed = hiddenLines(state).filter((line) => {
    const number = doc.lineAt(line.from).number;
    return forward
      ? number > start && number < end
      : number < start && number > end;
  });
  const line = forward ? passed[0] : passed[passed.length - 1];
  if (!line) return null;
  const at = entryPoint(line, !forward);
  return extend
    ? EditorSelection.range(range.anchor, at, moved.goalColumn)
    : EditorSelection.cursor(at, 0, undefined, moved.goalColumn);
}

/**
 * Up or Down, with `extend` set by Shift, stopping on a hidden line instead of passing it. The
 * view has no row for a hidden line, so CodeMirror's own commands would go to the row past it;
 * this one declines, leaving them to act, unless the move passes a hidden line.
 */
function verticalMove(forward: boolean, extend: boolean): Command {
  return (view) => {
    const { state } = view;
    if (!hiddenLines(state).length) return false;
    let stopped = false;
    const ranges = state.selection.ranges.map((range) => {
      if (!extend && !range.empty)
        return EditorSelection.cursor(forward ? range.to : range.from);
      const moved = view.moveVertically(range, forward);
      const stop = stopOnHidden(state, range, moved, forward, extend);
      if (stop) stopped = true;
      if (extend)
        return (
          stop ??
          EditorSelection.range(range.anchor, moved.head, moved.goalColumn)
        );
      return stop ?? moved;
    });
    if (!stopped) return false;
    view.dispatch({
      selection: EditorSelection.create(ranges, state.selection.mainIndex),
      scrollIntoView: true,
      userEvent: "select",
    });
    return true;
  };
}

/**
 * Whether a line, from `from` to `to`, is still a line of its own with its text unchanged, and,
 * when lines are being moved, whether no line moves past it.
 */
function survives(tr: Transaction, from: number, to: number): boolean {
  const moving = tr.isUserEvent("move");
  let touched = false;
  tr.changes.iterChangedRanges((fromA, toA) => {
    if (moving ? fromA <= to && toA >= from : fromA < to && toA > from)
      touched = true;
  });
  if (touched) return false;
  const start = tr.changes.mapPos(from, 1);
  const end = tr.changes.mapPos(to, -1);
  const line = tr.newDoc.lineAt(start);
  return line.from === start && line.to === end;
}

/**
 * Keeps edits from changing a line the user can't see. An edit that would change a hidden line
 * of syntax, join it to another line, as Backspace at the start of the line below a closing
 * fence would, or move a line past it, isn't made: the cursor moves onto the hidden line
 * instead, where Up or Down would put it, which shows it, and the same key then acts in view.
 */
const guard = EditorState.transactionFilter.of(
  (tr): Transaction | TransactionSpec => {
    if (
      !tr.docChanged ||
      !(
        tr.isUserEvent("input") ||
        tr.isUserEvent("delete") ||
        tr.isUserEvent("move")
      )
    )
      return tr;
    const line = hiddenLines(tr.startState).find(
      (line) => !survives(tr, line.from, line.to),
    );
    if (!line) return tr;
    const head = tr.startState.selection.main.head;
    return {
      selection: { anchor: entryPoint(line, head > line.to) },
      scrollIntoView: true,
      userEvent: "select",
    };
  },
);

/**
 * Leaves lines that hold nothing but syntax out of the view, so that they take up no room,
 * until the construct they belong to shows its source. A hidden line has no row, and so no
 * number in the gutter. Up and Down stop on a hidden line rather than pass it.
 */
export function syntaxLines(): Extension {
  return [
    hidden,
    guard,
    Prec.high(
      keymap.of([
        {
          key: "ArrowUp",
          run: verticalMove(false, false),
          shift: verticalMove(false, true),
        },
        {
          key: "ArrowDown",
          run: verticalMove(true, false),
          shift: verticalMove(true, true),
        },
      ]),
    ),
  ];
}
