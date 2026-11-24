import { diff, presentableDiff } from "@codemirror/merge";
import type { Text } from "@codemirror/state";

/**
 * A run of lines that differ between two texts, A and B. Lines are counted from zero, and each
 * range runs up to but not including its end, so an insertion has an empty range in A.
 */
export interface Hunk {
  fromA: number;
  toA: number;
  fromB: number;
  toB: number;
}

/** A change within a line: characters `fromA` to `toA` of the old line became `fromB` to `toB`. */
export interface Span {
  fromA: number;
  toA: number;
  fromB: number;
  toB: number;
}

const lineCache = new WeakMap<Text, readonly string[]>();

/** A text's lines. */
export function linesOf(text: Text): readonly string[] {
  let lines = lineCache.get(text);
  if (!lines) {
    lines = text.toJSON();
    lineCache.set(text, lines);
  }
  return lines;
}

/**
 * Compares two texts line by line. Each distinct line is given a character of its own, so that
 * the lines can be compared with a character diff.
 */
export function diffLines(a: readonly string[], b: readonly string[]): Hunk[] {
  let start = 0;
  const shorter = Math.min(a.length, b.length);
  while (start < shorter && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  if (start === endA && start === endB) return [];
  const whole = [{ fromA: start, toA: endA, fromB: start, toB: endB }];
  const codes = new Map<string, number>();
  let next = 0x20;
  let full = false;
  const encode = (lines: readonly string[], from: number, to: number) => {
    let out = "";
    for (let i = from; i < to; i++) {
      const line = lines[i] as string;
      let code = codes.get(line);
      if (code === undefined) {
        // Surrogates can't stand alone in a string that a character diff will cut up.
        if (next === 0xd800) next = 0xe000;
        if (next > 0xffff) full = true;
        code = next++;
        codes.set(line, code);
      }
      out += String.fromCharCode(code);
    }
    return out;
  };
  const textA = encode(a, start, endA);
  const textB = encode(b, start, endB);
  if (full) return whole;
  const hunks: Hunk[] = [];
  for (const change of diff(textA, textB, { scanLimit: 2000 })) {
    const hunk = {
      fromA: start + change.fromA,
      toA: start + change.toA,
      fromB: start + change.fromB,
      toB: start + change.toB,
    };
    const last = hunks[hunks.length - 1];
    if (last && last.toA === hunk.fromA && last.toB === hunk.fromB) {
      last.toA = hunk.toA;
      last.toB = hunk.toB;
    } else {
      hunks.push(hunk);
    }
  }
  return hunks;
}

/**
 * The changes within each line of a hunk, when the hunk reads better as edits to its lines than
 * as lines taken out and lines put in: it has as many lines after as before, and each still has
 * most of its text. Null otherwise.
 */
export function lineEdits(
  a: readonly string[],
  b: readonly string[],
  hunk: Hunk,
): Span[][] | null {
  const count = hunk.toA - hunk.fromA;
  if (count === 0 || count !== hunk.toB - hunk.fromB || count > 20) return null;
  const edits: Span[][] = [];
  for (let i = 0; i < count; i++) {
    const before = a[hunk.fromA + i] as string;
    const after = b[hunk.fromB + i] as string;
    const spans = presentableDiff(before, after, { scanLimit: 500 });
    let changed = 0;
    for (const span of spans)
      changed += span.toA - span.fromA + (span.toB - span.fromB);
    if (changed > 0.6 * Math.max(before.length, after.length)) return null;
    edits.push(
      spans.map(({ fromA, toA, fromB, toB }) => ({ fromA, toA, fromB, toB })),
    );
  }
  return edits;
}

/** Where a line boundary of A falls in B: the line of B that the boundary comes before. */
export function mapBoundary(hunks: readonly Hunk[], line: number): number {
  let offset = 0;
  for (const hunk of hunks) {
    if (line <= hunk.fromA) break;
    if (line < hunk.toA) return hunk.fromB;
    offset = hunk.toB - hunk.toA;
  }
  return line + offset;
}

/** Where a line of A is in B, for a line that no hunk covers. */
export function mapLine(hunks: readonly Hunk[], line: number): number {
  let offset = 0;
  for (const hunk of hunks) {
    if (line < hunk.fromA) break;
    offset = hunk.toB - hunk.toA;
  }
  return line + offset;
}

/** A change as the view shows it. */
export interface Block {
  /** Unstaged changes are between the index and the document; staged, between HEAD and the index. */
  kind: "unstaged" | "staged";
  hunk: Hunk;
  /**
   * The document lines the change put in, as runs. A staged change's lines that have changed
   * again since are left out, since they show as unstaged.
   */
  added: { from: number; to: number }[];
  /** The lines the change took out, in its base text, or null. */
  removed: { from: number; to: number } | null;
  /** The document line the removed lines are shown above. */
  at: number;
  /** The changes within the lines, when the change is shown as edits to them. */
  edits: Span[][] | null;
}

export function blockKey(block: Block): string {
  const { hunk } = block;
  return `${block.kind}:${hunk.fromA}:${hunk.toA}:${hunk.fromB}:${hunk.toB}`;
}

/**
 * Works out the changes to show in a document, given the texts of HEAD and the index. A staged
 * change is placed by carrying its lines from the index through the unstaged changes.
 */
export function buildBlocks(
  head: readonly string[],
  index: readonly string[],
  doc: readonly string[],
  staged: readonly Hunk[] = diffLines(head, index),
  unstaged: readonly Hunk[] = diffLines(index, doc),
): Block[] {
  const blocks: Block[] = [];
  for (const hunk of staged) {
    const added: { from: number; to: number }[] = [];
    let clean = true;
    for (let line = hunk.fromB; line < hunk.toB; line++) {
      const covered = unstaged.some((u) => u.fromA <= line && line < u.toA);
      if (covered) {
        clean = false;
        continue;
      }
      const at = mapLine(unstaged, line);
      const last = added[added.length - 1];
      if (last && last.to === at) last.to = at + 1;
      else added.push({ from: at, to: at + 1 });
    }
    blocks.push({
      kind: "staged",
      hunk,
      added,
      removed:
        hunk.toA > hunk.fromA ? { from: hunk.fromA, to: hunk.toA } : null,
      at: mapBoundary(unstaged, hunk.fromB),
      edits: clean ? lineEdits(head, index, hunk) : null,
    });
  }
  for (const hunk of unstaged) {
    blocks.push({
      kind: "unstaged",
      hunk,
      added: hunk.toB > hunk.fromB ? [{ from: hunk.fromB, to: hunk.toB }] : [],
      removed:
        hunk.toA > hunk.fromA ? { from: hunk.fromA, to: hunk.toA } : null,
      at: hunk.fromB,
      edits: lineEdits(index, doc, hunk),
    });
  }
  return blocks.sort(
    (x, y) =>
      x.at - y.at || (x.kind === y.kind ? 0 : x.kind === "staged" ? -1 : 1),
  );
}

function splice(
  lines: readonly string[],
  from: number,
  to: number,
  insert: readonly string[],
): string[] {
  return [...lines.slice(0, from), ...insert, ...lines.slice(to)];
}

/**
 * The index's lines after staging or unstaging one change: staging puts the document's version
 * of the change into the index, and unstaging puts HEAD's version back.
 */
export function indexAfter(
  block: Block,
  head: readonly string[],
  index: readonly string[],
  doc: readonly string[],
): string[] {
  const { hunk } = block;
  return block.kind === "unstaged"
    ? splice(index, hunk.fromA, hunk.toA, doc.slice(hunk.fromB, hunk.toB))
    : splice(index, hunk.fromB, hunk.toB, head.slice(hunk.fromA, hunk.toA));
}
