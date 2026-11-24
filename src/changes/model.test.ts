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
  mapBoundary,
  mapLine,
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

describe("mapping", () => {
  const hunks = [
    { fromA: 2, toA: 2, fromB: 2, toB: 4 },
    { fromA: 5, toA: 7, fromB: 7, toB: 8 },
  ];

  test("a boundary before a change stays before it", () => {
    expect(mapBoundary(hunks, 1)).toBe(1);
    expect(mapBoundary(hunks, 2)).toBe(2);
    expect(mapBoundary(hunks, 3)).toBe(5);
    expect(mapBoundary(hunks, 6)).toBe(7);
    expect(mapBoundary(hunks, 7)).toBe(8);
    expect(mapBoundary(hunks, 9)).toBe(10);
  });

  test("a line moves by the lines put in and taken out before it", () => {
    expect(mapLine(hunks, 1)).toBe(1);
    expect(mapLine(hunks, 2)).toBe(4);
    expect(mapLine(hunks, 4)).toBe(6);
    expect(mapLine(hunks, 7)).toBe(8);
  });
});

describe("buildBlocks", () => {
  const head = lines("one\ntwo\nthree\nfour");
  const index = lines("one\nTWO\nthree\nfour\nfive");
  const doc = lines("zero\none\nTWO\nthree\nfive");

  const summary = (blocks: Block[]) =>
    blocks.map(
      (block) =>
        `${block.kind} at ${block.at} added ${block.added
          .map((run) => `${run.from}-${run.to}`)
          .join(",")} removed ${
          block.removed ? `${block.removed.from}-${block.removed.to}` : "none"
        }`,
    );

  test("places staged changes in the document, through the unstaged ones", () => {
    expect(summary(buildBlocks(head, index, doc))).toEqual([
      "unstaged at 0 added 0-1 removed none",
      "staged at 2 added 2-3 removed 1-2",
      // Where a staged and an unstaged change meet, the staged one, which is the older, is first.
      "staged at 4 added 4-5 removed none",
      "unstaged at 4 added  removed 3-4",
    ]);
  });

  test("leaves out of a staged change the lines that have changed again", () => {
    const blocks = buildBlocks(lines("a\nb"), lines("a\nB"), lines("a\nB!"));
    expect(summary(blocks)).toEqual([
      "staged at 1 added  removed 1-2",
      "unstaged at 1 added 1-2 removed 1-2",
    ]);
    expect(blocks[0]?.edits).toBeNull();
  });

  test("shows a small change to a line as an edit to it", () => {
    const [block] = buildBlocks(
      lines("the quick brown fox jumps over the lazy dog"),
      lines("the quick brown fox jumps over the lazy dog"),
      lines("the quiet brown fox jumps over the lazy dog"),
    );
    expect(block?.edits).toEqual([[{ fromA: 4, toA: 9, fromB: 4, toB: 9 }]]);
    expect(blockKey(block as Block)).toBe("unstaged:0:1:0:1");
  });
});

describe("indexAfter", () => {
  const texts = [
    ["one\ntwo\nthree\n", "one\n2\nthree\n", "one\n2\nthree\nfour\n"],
    ["a\nb\nc", "a\nc", "x\na\nc\nd"],
    ["", "new\n", "new\nnewer\n"],
    ["a\n\nb\n\nc\n", "a\n\nB\n\nc\n", "A\n\nB\n\nC"],
    ["keep\ndrop\n", "keep\n", ""],
  ] as const;

  for (const [head, index, doc] of texts) {
    const label = JSON.stringify([head, index, doc]);

    test(`staging every change makes the index the document: ${label}`, () => {
      let current = lines(index);
      for (let guard = 0; guard < 20; guard++) {
        const block = buildBlocks(lines(head), current, lines(doc)).find(
          (b) => b.kind === "unstaged",
        );
        if (!block) break;
        current = indexAfter(block, lines(head), current, lines(doc));
      }
      expect(current.join("\n")).toBe(doc);
    });

    test(`unstaging every change makes the index HEAD: ${label}`, () => {
      let current = lines(index);
      for (let guard = 0; guard < 20; guard++) {
        const block = buildBlocks(lines(head), current, lines(doc)).find(
          (b) => b.kind === "staged",
        );
        if (!block) break;
        current = indexAfter(block, lines(head), current, lines(doc));
      }
      expect(current.join("\n")).toBe(head);
    });
  }

  test("staging one change leaves the others unstaged", () => {
    const head = lines("a\n\nb\n\nc");
    const doc = lines("A\n\nb\n\nC");
    const [first] = buildBlocks(head, head, doc);
    const index = indexAfter(first as Block, head, head, doc);
    expect(index).toEqual(lines("A\n\nb\n\nc"));
  });
});

test("a text's lines are worked out once", () => {
  const text = Text.of(["a", "b"]);
  expect(linesOf(text)).toEqual(["a", "b"]);
  expect(linesOf(text)).toBe(linesOf(text));
});
