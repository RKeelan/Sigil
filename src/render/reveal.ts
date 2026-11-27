import { syntaxTree } from "@codemirror/language";
import {
  type EditorState,
  Facet,
  StateEffect,
  StateField,
  type Transaction,
} from "@codemirror/state";

/** A range of the document, from `from` to `to`. */
export interface Span {
  from: number;
  to: number;
}

/**
 * How much raw source the cursor reveals: the whole of each source line the selection touches,
 * or only the constructs the selection touches, such as one emphasised span or link.
 */
export type RevealScope = "line" | "construct";

/** The reveal scope the editor uses, which is whole lines unless configured otherwise. */
export const revealScope = Facet.define<RevealScope, RevealScope>({
  combine: (values) => values[0] ?? "line",
});

/** Says whether a mouse button is down over the text. */
export const setPointer = StateEffect.define<boolean>();

/** Whether a mouse button is down over the text. */
export const pointerDown = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects)
      if (effect.is(setPointer)) value = effect.value;
    return value;
  },
});

/**
 * Blocks that show their source as a whole when the cursor is anywhere in them. A setext
 * heading is one of them because its underline is a line of its own.
 */
const wholeBlocks = new Set([
  "Table",
  "FencedCode",
  "SetextHeading1",
  "SetextHeading2",
]);

function lineSpans(state: EditorState): Span[] {
  const spans: Span[] = [];
  const tree = syntaxTree(state);
  for (const range of state.selection.ranges) {
    let from = state.doc.lineAt(range.from).from;
    let to = state.doc.lineAt(range.to).to;
    for (const [pos, side] of [
      [from, 1],
      [to, -1],
    ] as const) {
      for (
        let node = tree.resolveInner(pos, side);
        node.parent;
        node = node.parent
      ) {
        if (!wholeBlocks.has(node.name)) continue;
        from = Math.min(from, state.doc.lineAt(node.from).from);
        to = Math.max(to, state.doc.lineAt(node.to).to);
      }
    }
    const last = spans[spans.length - 1];
    if (last && from <= last.to + 1) last.to = Math.max(last.to, to);
    else spans.push({ from, to });
  }
  return spans;
}

/** What the selection reveals, and how what it reveals is decided. */
export interface Revealed {
  scope: RevealScope;
  /**
   * In line scope, the lines the selection touches, widened to the whole of a table, fenced
   * block or setext heading. In construct scope, the selection's own ranges.
   */
  spans: readonly Span[];
}

function revealedIn(state: EditorState): Revealed {
  const scope = state.facet(revealScope);
  const spans =
    scope === "line"
      ? lineSpans(state)
      : state.selection.ranges.map(({ from, to }) => ({ from, to }));
  return { scope, spans };
}

/** What was revealed before an edit, carried through it. */
function mapped(value: Revealed, tr: Transaction): Revealed {
  const { doc } = tr.state;
  const spans = value.spans.map((span) => {
    const from = tr.changes.mapPos(span.from, 1);
    const to = Math.max(from, tr.changes.mapPos(span.to, -1));
    return value.scope === "line"
      ? { from: doc.lineAt(from).from, to: doc.lineAt(to).to }
      : { from, to };
  });
  return { scope: value.scope, spans };
}

function sameRevealed(a: Revealed, b: Revealed): boolean {
  return (
    a.scope === b.scope &&
    a.spans.length === b.spans.length &&
    a.spans.every(
      (span, i) => span.from === b.spans[i]?.from && span.to === b.spans[i]?.to,
    )
  );
}

/**
 * What the selection reveals. It stays as it is while a mouse button is down, because showing
 * syntax moves text, and text that moves under the pointer turns a click into a drag.
 */
export const revealed = StateField.define<Revealed>({
  create: revealedIn,
  update(value, tr) {
    let next: Revealed;
    const rescoped =
      tr.startState.facet(revealScope) !== tr.state.facet(revealScope);
    if (tr.state.field(pointerDown) && !rescoped) {
      if (!tr.docChanged) return value;
      next = mapped(value, tr);
    } else {
      next = revealedIn(tr.state);
    }
    return sameRevealed(value, next) ? value : next;
  },
});
