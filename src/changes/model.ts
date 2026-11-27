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

/** A line of A shown as edited into a line of B, with the changes within it. */
export interface LineEdit {
  /** The line in A, counted from zero. */
  a: number;
  /** The line in B, counted from zero. */
  b: number;
  spans: Span[];
}

/** The most lines on either side of a hunk whose lines are paired as edits. */
const pairLimit = 20;

/** A line's runs of three characters, each with how often it occurs. */
interface Triples {
  counts: Map<string, number>;
  total: number;
}

function triples(line: string): Triples {
  const counts = new Map<string, number>();
  for (let i = 0; i + 3 <= line.length; i++) {
    const triple = line.slice(i, i + 3);
    counts.set(triple, (counts.get(triple) ?? 0) + 1);
  }
  return { counts, total: Math.max(0, line.length - 2) };
}

/** Fewer runs of three characters than this, and how many two lines share says little. */
const fewTriples = 24;

/**
 * The share of their runs of three characters that two lines have in common, from 0 to 1, or 1
 * when either is too short to tell. Counting them is quick, where comparing two long lines
 * character by character is slow, above all when they have little in common, since the
 * comparison then runs to its limit before giving up. A small edit changes only the runs that
 * cross it, so a line with a letter changed in every word still shares half of them; unrelated
 * paragraphs of prose share about a fifth.
 */
function overlap(before: Triples, after: Triples): number {
  if (before.total < fewTriples || after.total < fewTriples) return 1;
  let shared = 0;
  for (const [triple, count] of before.counts)
    shared += Math.min(count, after.counts.get(triple) ?? 0);
  return shared / Math.max(before.total, after.total);
}

/** Lines that share less than this of their runs of three characters aren't compared. */
const leastOverlap = 0.4;

/**
 * Whether one line could be an edit to another: the change in length alone, which every
 * comparison has to make, isn't too much of the longer line.
 */
function couldBeEdit(before: string, after: string): boolean {
  const longest = Math.max(before.length, after.length);
  return Math.abs(before.length - after.length) <= 0.6 * longest;
}

/** How much of its text a line keeps when it becomes another, and the changes within it. */
interface Kept {
  kept: number;
  spans: Span[];
}

/**
 * How much of its text a line keeps when it becomes another, counted in characters, and the
 * changes within it. Null when the line is mostly rewritten, or keeps nothing, and so reads
 * better as a line taken out and another put in.
 */
function similarity(before: string, after: string): Kept | null {
  const limit = 0.6 * Math.max(before.length, after.length);
  const spans = presentableDiff(before, after, { scanLimit: 500 });
  let changed = 0;
  for (const span of spans)
    changed += span.toA - span.fromA + (span.toB - span.fromB);
  const kept = (before.length + after.length - changed) / 2;
  if (changed > limit || kept === 0) return null;
  return {
    kept,
    spans: spans.map(({ fromA, toA, fromB, toB }) => ({
      fromA,
      toA,
      fromB,
      toB,
    })),
  };
}

/**
 * The lines of a hunk that read better as edits to a line than as lines taken out and put in,
 * each paired with the line it became. Pairs keep their order on both sides, and are chosen to
 * keep the most text between them, so that an edited line with lines put in beside it is still
 * shown as an edit. A large hunk has no pairs, since comparing every line with every other would
 * be slow.
 */
export function lineEdits(
  a: readonly string[],
  b: readonly string[],
  hunk: Hunk,
): LineEdit[] {
  const n = hunk.toA - hunk.fromA;
  const m = hunk.toB - hunk.fromB;
  if (n === 0 || m === 0 || n > pairLimit || m > pairLimit) return [];
  const linesA = a.slice(hunk.fromA, hunk.toA);
  const linesB = b.slice(hunk.fromB, hunk.toB);
  const key = JSON.stringify([linesA, linesB]);
  let edits = pairings.get(key);
  if (!edits) {
    edits = pairLines(linesA, linesB);
    if (pairings.size >= pairingsKept) pairings.clear();
    pairings.set(key, edits);
  }
  return edits.map(({ a, b, spans }) => ({
    a: hunk.fromA + a,
    b: hunk.fromB + b,
    spans,
  }));
}

/**
 * The pairs found for recent hunks, keyed by their lines. The changes are worked out again on
 * every edit, and an edit changes one hunk at most, so the others' pairs are found here.
 */
const pairings = new Map<string, LineEdit[]>();
const pairingsKept = 200;

/** Pairs the lines of a hunk, given the lines it took out and put in, counting from zero. */
function pairLines(
  linesA: readonly string[],
  linesB: readonly string[],
): LineEdit[] {
  const n = linesA.length;
  const m = linesB.length;
  const triplesA = linesA.map(triples);
  const triplesB = linesB.map(triples);
  // The lines most alike are compared first, until the comparisons have covered one and a half
  // times the hunk's text, so that a hunk costs little more than comparing each line once would.
  const candidates: { i: number; j: number; likeness: number }[] = [];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < m; j++) {
      if (!couldBeEdit(linesA[i] as string, linesB[j] as string)) continue;
      const likeness = overlap(triplesA[i] as Triples, triplesB[j] as Triples);
      if (likeness >= leastOverlap) candidates.push({ i, j, likeness });
    }
  candidates.sort((x, y) => y.likeness - x.likeness);
  let budget = 0;
  for (const line of [...linesA, ...linesB]) budget += 1.5 * line.length;
  const pair: (Kept | null)[][] = Array.from({ length: n }, () =>
    new Array(m).fill(null),
  );
  for (const { i, j } of candidates) {
    const before = linesA[i] as string;
    const after = linesB[j] as string;
    budget -= before.length + after.length;
    if (budget < 0) break;
    (pair[i] as (Kept | null)[])[j] = similarity(before, after);
  }
  // best[i][j] is the most text kept by pairs among the first i lines of A and first j of B.
  const best = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  const at = (i: number, j: number) => (best[i] as number[])[j] as number;
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++) {
      const both = pair[i - 1]?.[j - 1];
      (best[i] as number[])[j] = Math.max(
        at(i - 1, j),
        at(i, j - 1),
        both ? at(i - 1, j - 1) + both.kept : 0,
      );
    }
  const edits: LineEdit[] = [];
  for (let i = n, j = m; i > 0 && j > 0;) {
    const both = pair[i - 1]?.[j - 1];
    if (both && at(i, j) === at(i - 1, j - 1) + both.kept) {
      edits.push({ a: i - 1, b: j - 1, spans: both.spans });
      i--;
      j--;
    } else if (at(i, j) === at(i - 1, j)) i--;
    else j--;
  }
  return edits.reverse();
}

/** Lines of A taken out with no line of B in their place, and the line of B they are shown above. */
export interface Removal {
  from: number;
  to: number;
  at: number;
}

/**
 * The runs of a hunk's lines in A that aren't edits to a line of B. Each is shown above the lines
 * of B that were put in where it was, or above the line after them when none were.
 */
export function removals(hunk: Hunk, edits: readonly LineEdit[]): Removal[] {
  const runs: Removal[] = [];
  let a = hunk.fromA;
  let b = hunk.fromB;
  for (const edit of [...edits, { a: hunk.toA, b: hunk.toB }]) {
    if (edit.a > a) runs.push({ from: a, to: edit.a, at: b });
    a = edit.a + 1;
    b = edit.b + 1;
  }
  return runs;
}

/**
 * A change as the view shows it: a difference between the index and the document. A staged
 * change is in the index already, so it is not one.
 */
export interface Block {
  /** The index lines (A) the change took out, and the document lines (B) it put in. */
  hunk: Hunk;
  /** The index lines shown as edits to document lines. The document's other lines were put in. */
  edits: LineEdit[];
  /** The index lines that aren't edits, shown as lines taken out. */
  removals: Removal[];
}

export function blockKey(block: Block): string {
  const { hunk } = block;
  return `${hunk.fromA}:${hunk.toA}:${hunk.fromB}:${hunk.toB}`;
}

/**
 * Works out the changes to show in a document, given the text of the index. A change for which
 * `canEdit` is false, given a hunk that both takes lines out and puts them in, is shown as lines
 * taken out and lines put in, with no line shown as an edit.
 */
export function buildBlocks(
  index: readonly string[],
  doc: readonly string[],
  canEdit: (hunk: Hunk) => boolean = () => true,
): Block[] {
  return diffLines(index, doc).map((hunk) => {
    const pairable =
      hunk.toA > hunk.fromA && hunk.toB > hunk.fromB && canEdit(hunk);
    const edits = pairable ? lineEdits(index, doc, hunk) : [];
    return { hunk, edits, removals: removals(hunk, edits) };
  });
}

/** The index's lines after staging one change, which puts the document's version of it there. */
export function indexAfter(
  block: Block,
  index: readonly string[],
  doc: readonly string[],
): string[] {
  const { hunk } = block;
  return [
    ...index.slice(0, hunk.fromA),
    ...doc.slice(hunk.fromB, hunk.toB),
    ...index.slice(hunk.toA),
  ];
}
