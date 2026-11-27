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
 * How long a comparison of lines may take, in milliseconds, before it settles for a rougher
 * answer. The comparison takes time in proportion to the text's length times the number of
 * changes, so a document of book length with every paragraph changed takes most of a second; it
 * is compared in whole only when the index is given, and in part after each edit.
 */
const diffTimeout = 2000;

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
  for (const change of diff(textA, textB, { timeout: diffTimeout })) {
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
  const edits = pairLines(
    a.slice(hunk.fromA, hunk.toA),
    b.slice(hunk.fromB, hunk.toB),
  );
  return edits.map(({ a, b, spans }) => ({
    a: hunk.fromA + a,
    b: hunk.fromB + b,
    spans,
  }));
}

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
  return diffLines(index, doc).map((hunk) =>
    blockOf(hunk, index, doc, canEdit),
  );
}

function blockOf(
  hunk: Hunk,
  index: readonly string[],
  doc: readonly string[],
  canEdit: (hunk: Hunk) => boolean,
): Block {
  const pairable =
    hunk.toA > hunk.fromA && hunk.toB > hunk.fromB && canEdit(hunk);
  const edits = pairable ? lineEdits(index, doc, hunk) : [];
  return { hunk, edits, removals: removals(hunk, edits) };
}

/** A block moved down by `byA` lines of the index and `byB` lines of the document. */
function shift(block: Block, byA: number, byB: number): Block {
  if (byA === 0 && byB === 0) return block;
  const { hunk } = block;
  return {
    hunk: {
      fromA: hunk.fromA + byA,
      toA: hunk.toA + byA,
      fromB: hunk.fromB + byB,
      toB: hunk.toB + byB,
    },
    edits: block.edits.map(({ a, b, spans }) => ({
      a: a + byA,
      b: b + byB,
      spans,
    })),
    removals: block.removals.map(({ from, to, at }) => ({
      from: from + byA,
      to: to + byA,
      at: at + byB,
    })),
  };
}

/**
 * An edit to the document's lines: lines `from` up to `to` of the document before it, counted
 * from zero, became `length` lines.
 */
export interface LineChange {
  from: number;
  to: number;
  length: number;
}

/**
 * The changes to show after an edit to the document, given those shown before it. Only the lines
 * the edit touched, and the changes they touch or adjoin, are compared again; the changes before
 * them stay as they were, and those after them move with the lines the edit put in or took out.
 * So an edit costs the same however many other changes the document has.
 */
export function updateBlocks(
  blocks: readonly Block[],
  index: readonly string[],
  doc: readonly string[],
  edit: LineChange,
  canEdit: (hunk: Hunk) => boolean = () => true,
): Block[] {
  // The blocks from `first` up to `end` touch or adjoin the edited lines.
  let first = 0;
  while (first < blocks.length && (blocks[first] as Block).hunk.toB < edit.from)
    first++;
  let end = first;
  while (end < blocks.length && (blocks[end] as Block).hunk.fromB <= edit.to)
    end++;
  // Outside the blocks, the index's lines and the document's match one for one, so a line of the
  // document there has a line of the index `offset` lines away.
  let offset = 0;
  for (let i = 0; i < first; i++) {
    const { hunk } = blocks[i] as Block;
    offset += hunk.toA - hunk.fromA - (hunk.toB - hunk.fromB);
  }
  let fromB = edit.from;
  let toB = edit.to;
  let fromA = fromB + offset;
  let toA = toB + offset;
  if (end > first) {
    const firstHunk = (blocks[first] as Block).hunk;
    const lastHunk = (blocks[end - 1] as Block).hunk;
    if (firstHunk.fromB < fromB) {
      fromB = firstHunk.fromB;
      fromA = firstHunk.fromA;
    }
    if (lastHunk.toB > toB) {
      toB = lastHunk.toB;
      toA = lastHunk.toA;
    } else {
      toA = toB + offset;
      for (let i = first; i < end; i++) {
        const { hunk } = blocks[i] as Block;
        toA += hunk.toA - hunk.fromA - (hunk.toB - hunk.fromB);
      }
    }
  }
  const grown = edit.length - (edit.to - edit.from);
  const newToB = toB + grown;
  const docPart = doc.slice(fromB, newToB);
  const indexPart = index.slice(fromA, toA);
  const middle = diffLines(indexPart, docPart).map((part) => {
    const hunk = {
      fromA: part.fromA + fromA,
      toA: part.toA + fromA,
      fromB: part.fromB + fromB,
      toB: part.toB + fromB,
    };
    return blockOf(hunk, index, doc, canEdit);
  });
  return [
    ...blocks.slice(0, first),
    ...middle,
    ...blocks.slice(end).map((block) => shift(block, 0, grown)),
  ];
}

/**
 * The changes to show after one of them is staged, which puts the document's version of it in
 * the index. The others stay as they were, and those after it move with the lines it put in the
 * index or took out of it.
 */
export function blocksAfterStaging(
  blocks: readonly Block[],
  staged: Block,
): Block[] {
  const { hunk } = staged;
  const grown = hunk.toB - hunk.fromB - (hunk.toA - hunk.fromA);
  const kept: Block[] = [];
  for (const block of blocks) {
    if (blockKey(block) === blockKey(staged)) continue;
    kept.push(block.hunk.fromA >= hunk.toA ? shift(block, grown, 0) : block);
  }
  return kept;
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
