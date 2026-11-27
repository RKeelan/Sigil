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
    ).toEqual([[{ fromA: 4, toA: 9, fromB: 4, toB: 8 }]]);
  });

  test("gives up on a line that is mostly rewritten", () => {
    expect(lineEdits(["one"], ["something else entirely"], hunk)).toBeNull();
  });

  test("gives up when lines were put in or taken out", () => {
    expect(
      lineEdits(["a"], ["a", "b"], { fromA: 0, toA: 1, fromB: 0, toB: 2 }),
    ).toBeNull();
    expect(
      lineEdits([], ["a"], { fromA: 0, toA: 0, fromB: 0, toB: 1 }),
    ).toBeNull();
  });
});

describe("buildBlocks", () => {
  const summary = (blocks: Block[]) =>
    blocks.map(
      ({ at, added, removed }) =>
        `at ${at} added ${added ? `${added.from}-${added.to}` : "none"} removed ${
          removed ? `${removed.from}-${removed.to}` : "none"
        }`,
    );

  test("finds the changes between the index and the document", () => {
    const index = lines("one\nTWO\nthree\nfour\nfive");
    const doc = lines("zero\none\nTWO\nthree\nfive");
    expect(summary(buildBlocks(index, doc))).toEqual([
      "at 0 added 0-1 removed none",
      "at 4 added none removed 3-4",
    ]);
  });

  test("shows a small change to a line as an edit to it", () => {
    const [block] = buildBlocks(
      lines("the quick brown fox jumps over the lazy dog"),
      lines("the quiet brown fox jumps over the lazy dog"),
    );
    expect(block?.edits).toEqual([[{ fromA: 4, toA: 9, fromB: 4, toB: 9 }]]);
    expect(blockKey(block as Block)).toBe("0:1:0:1");
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
