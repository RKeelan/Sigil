import { describe, expect, test } from "bun:test";
import { Text } from "@codemirror/state";
import {
  type Block,
  blockKey,
  buildBlocks,
  diffLines,
  indexAfter,
  lineEdits,
  linesOf,
  removals,
} from "./model.ts";

const lines = (text: string) => text.split("\n");

describe("diffLines", () => {
  test("finds nothing between equal texts", () => {
    expect(diffLines(lines("a\nb"), lines("a\nb"))).toEqual([]);
    expect(diffLines([""], [""])).toEqual([]);
  });

  test("finds lines put in, taken out and changed", () => {
    expect(diffLines(lines("a\nc"), lines("a\nb\nc"))).toEqual([
      { fromA: 1, toA: 1, fromB: 1, toB: 2 },
    ]);
    expect(diffLines(lines("a\nb\nc"), lines("a\nc"))).toEqual([
      { fromA: 1, toA: 2, fromB: 1, toB: 1 },
    ]);
    expect(diffLines(lines("a\nb\nc"), lines("a\nB\nc"))).toEqual([
      { fromA: 1, toA: 2, fromB: 1, toB: 2 },
    ]);
  });

  test("keeps changes apart when a line between them is the same", () => {
    expect(
      diffLines(lines("one\n\ntwo\n\nthree"), lines("ONE\n\ntwo\n\nTHREE")),
    ).toEqual([
      { fromA: 0, toA: 1, fromB: 0, toB: 1 },
      { fromA: 4, toA: 5, fromB: 4, toB: 5 },
    ]);
  });

  test("treats a final line break as a last, empty line", () => {
    expect(diffLines(lines("a\n"), lines("a"))).toEqual([
      { fromA: 1, toA: 2, fromB: 1, toB: 1 },
    ]);
    expect(diffLines(lines("a"), lines("a\nb"))).toEqual([
      { fromA: 1, toA: 1, fromB: 1, toB: 2 },
    ]);
  });

  test("copes with more distinct lines than there are characters to stand for them", () => {
    const a = Array.from({ length: 40000 }, (_, i) => `a${i}`);
    const b = Array.from({ length: 40000 }, (_, i) => `b${i}`);
    expect(diffLines(["same", ...a, "end"], ["same", ...b, "end"])).toEqual([
      { fromA: 1, toA: 40001, fromB: 1, toB: 40001 },
    ]);
  });
});

describe("lineEdits", () => {
  const hunk = { fromA: 0, toA: 1, fromB: 0, toB: 1 };

  test("gives the changes within a line that keeps most of its text", () => {
    expect(
      lineEdits(["the quick brown fox"], ["the slow brown fox"], hunk),
    ).toEqual([
      { a: 0, b: 0, spans: [{ fromA: 4, toA: 9, fromB: 4, toB: 8 }] },
    ]);
  });

  test("gives up on a line that is mostly rewritten", () => {
    expect(lineEdits(["one"], ["something else entirely"], hunk)).toEqual([]);
  });

  test("pairs an edited line with the line it became when lines were put in beside it", () => {
    const edits = lineEdits(
      ["away for three years"],
      ["away for four years", "", "## Bought"],
      { fromA: 0, toA: 1, fromB: 0, toB: 3 },
    );
    expect(edits.map(({ a, b }) => [a, b])).toEqual([[0, 0]]);
    expect(
      lineEdits(["intro", "the quick brown fox"], ["the slow brown fox"], {
        fromA: 0,
        toA: 2,
        fromB: 0,
        toB: 1,
      }).map(({ a, b }) => [a, b]),
    ).toEqual([[1, 0]]);
  });

  test("keeps pairs in order on both sides, keeping the most text", () => {
    const a = ["alpha beta gamma", "delta epsilon zeta"];
    const b = ["# new", "delta epsilon zeta!", "alpha beta gamma!"];
    const edits = lineEdits(a, b, { fromA: 0, toA: 2, fromB: 0, toB: 3 });
    expect(edits.map(({ a, b }) => [a, b])).toEqual([[1, 1]]);
  });

  test("pairs long paragraphs with their edits among paragraphs put in", () => {
    const words = (seed: number) =>
      Array.from({ length: 60 }, (_, k) => `p${seed}w${k}`);
    const old = [1, 2, 3].map((seed) => words(seed));
    const a = old.map((w) => w.join(" "));
    const edited = old.map((w) =>
      w.map((word, k) => (k % 10 === 5 ? "changed" : word)).join(" "),
    );
    const b = [
      words(4).join(" "),
      edited[0],
      edited[1],
      words(5).join(" "),
      edited[2],
    ] as string[];
    const edits = lineEdits(a, b, { fromA: 0, toA: 3, fromB: 0, toB: 5 });
    expect(edits.map(({ a, b }) => [a, b])).toEqual([
      [0, 1],
      [1, 2],
      [2, 4],
    ]);
  });

  test("pairs a long paragraph with small edits all through it", () => {
    const before =
      "The colour of the harbour was grey, and the neighbours gathered on the quay to watch the ship come in; nobody spoke, and the gulls circled overhead in the cold morning air.";
    const after = before
      .split(" ")
      .map((word, k) => (k % 2 ? word.replace(/our/, "or") || word : word))
      .join(" ")
      .replace(/,/g, ";")
      .replace(/the /g, "teh ");
    const edits = lineEdits([before], [after, "", "## Added"], {
      fromA: 0,
      toA: 1,
      fromB: 0,
      toB: 3,
    });
    expect(edits.map(({ a, b }) => [a, b])).toEqual([[0, 0]]);
  });

  test("pairs nothing when no line was taken out or none was put in", () => {
    expect(
      lineEdits([], ["a"], { fromA: 0, toA: 0, fromB: 0, toB: 1 }),
    ).toEqual([]);
  });
});

describe("removals", () => {
  test("puts each run of lines that aren't edits above the lines put in where it was", () => {
    const hunk = { fromA: 0, toA: 4, fromB: 0, toB: 3 };
    const spans: never[] = [];
    expect(removals(hunk, [{ a: 1, b: 1, spans }])).toEqual([
      { from: 0, to: 1, at: 0 },
      { from: 2, to: 4, at: 2 },
    ]);
    expect(removals(hunk, [])).toEqual([{ from: 0, to: 4, at: 0 }]);
  });
});

describe("buildBlocks", () => {
  const summary = (blocks: Block[]) =>
    blocks.map(({ hunk, edits, removals }) =>
      [
        `${hunk.fromB}-${hunk.toB}`,
        ...edits.map(({ a, b }) => `edit ${a}>${b}`),
        ...removals.map(({ from, to, at }) => `removed ${from}-${to} at ${at}`),
      ].join(" "),
    );

  test("finds the changes between the index and the document", () => {
    const index = lines("one\nTWO\nthree\nfour\nfive");
    const doc = lines("zero\none\nTWO\nthree\nfive");
    expect(summary(buildBlocks(index, doc))).toEqual([
      "0-1",
      "4-4 removed 3-4 at 4",
    ]);
  });

  test("shows a small change to a line as an edit to it", () => {
    const [block] = buildBlocks(
      lines("the quick brown fox jumps over the lazy dog"),
      lines("the quiet brown fox jumps over the lazy dog"),
    );
    expect(block?.edits).toEqual([
      { a: 0, b: 0, spans: [{ fromA: 4, toA: 9, fromB: 4, toB: 9 }] },
    ]);
    expect(block?.removals).toEqual([]);
    expect(blockKey(block as Block)).toBe("0:1:0:1");
  });

  test("shows an edited line as an edit when lines were put in beside it", () => {
    const index = lines("# Notes\n\naway for three years\n\n- bread");
    const doc = lines("# Notes\n\naway for four years\n\n## Bought\n\n- bread");
    expect(summary(buildBlocks(index, doc))).toEqual(["2-5 edit 2>2"]);
  });

  test("shows no edits in a change that can't show them", () => {
    const blocks = buildBlocks(lines("a cat"), lines("a hat"), () => false);
    expect(summary(blocks)).toEqual(["0-1 removed 0-1 at 0"]);
  });
});

describe("indexAfter", () => {
  const texts = [
    ["one\n2\nthree\n", "one\n2\nthree\nfour\n"],
    ["a\nc", "x\na\nc\nd"],
    ["new\n", "new\nnewer\n"],
    ["a\n\nB\n\nc\n", "A\n\nB\n\nC"],
    ["keep\n", ""],
  ] as const;

  for (const [index, doc] of texts) {
    test(`staging every change makes the index the document: ${JSON.stringify([index, doc])}`, () => {
      let current = lines(index);
      for (let guard = 0; guard < 20; guard++) {
        const [block] = buildBlocks(current, lines(doc));
        if (!block) break;
        current = indexAfter(block, current, lines(doc));
      }
      expect(current.join("\n")).toBe(doc);
    });
  }

  test("staging one change leaves the others unstaged", () => {
    const index = lines("a\n\nb\n\nc");
    const doc = lines("A\n\nb\n\nC");
    const [first] = buildBlocks(index, doc);
    const after = indexAfter(first as Block, index, doc);
    expect(after).toEqual(lines("A\n\nb\n\nc"));
    expect(buildBlocks(after, doc).length).toBe(1);
  });
});

test("a text's lines are worked out once", () => {
  const text = Text.of(["a", "b"]);
  expect(linesOf(text)).toEqual(["a", "b"]);
  expect(linesOf(text)).toBe(linesOf(text));
});
