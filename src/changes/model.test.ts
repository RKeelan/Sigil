import { describe, expect, test } from "bun:test";
import { Text } from "@codemirror/state";
import {
  type Block,
  blockKey,
  blocksAfterStaging,
  buildBlocks,
  diffLines,
  indexAfter,
  lineEdits,
  linesOf,
  removals,
  updateBlocks,
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

/**
 * Fails unless the blocks describe the document exactly: in order, each a real difference, and
 * the lines between them the same in the index and the document.
 */
function expectDescribes(
  blocks: readonly Block[],
  index: readonly string[],
  doc: readonly string[],
) {
  let a = 0;
  let b = 0;
  const gap = (toA: number, toB: number) => {
    expect(toA - a).toBe(toB - b);
    expect(index.slice(a, toA)).toEqual(doc.slice(b, toB));
  };
  for (const { hunk, edits, removals: runs } of blocks) {
    gap(hunk.fromA, hunk.fromB);
    expect(hunk.toA > hunk.fromA || hunk.toB > hunk.fromB).toBe(true);
    expect(index.slice(hunk.fromA, hunk.toA)).not.toEqual(
      doc.slice(hunk.fromB, hunk.toB),
    );
    expect(edits).toEqual(lineEdits(index, doc, hunk));
    expect(runs).toEqual(removals(hunk, edits));
    for (const edit of edits) {
      expect(edit.a >= hunk.fromA && edit.a < hunk.toA).toBe(true);
      expect(edit.b >= hunk.fromB && edit.b < hunk.toB).toBe(true);
    }
    a = hunk.toA;
    b = hunk.toB;
  }
  gap(index.length, doc.length);
}

describe("updateBlocks", () => {
  // A small, seeded generator, so that a failure can be reproduced.
  let seed = 1;
  const random = (below: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return Math.floor((seed / 2147483648) * below);
  };
  const vocabulary = [
    "",
    "",
    "one",
    "two",
    "the quick brown fox",
    "the quick brown cat",
  ];
  const someLines = (count: number) =>
    Array.from(
      { length: count },
      () => vocabulary[random(vocabulary.length)] as string,
    );

  test("keeps describing the document through many edits and stagings", () => {
    for (let round = 0; round < 50; round++) {
      let index = someLines(1 + random(30));
      let doc = [...index];
      for (let i = 0; i < 5; i++) {
        const at = random(doc.length + 1);
        doc.splice(at, random(3), ...someLines(random(3)));
      }
      if (doc.length === 0) doc = [""];
      let blocks = buildBlocks(index, doc);
      for (let step = 0; step < 20; step++) {
        if (blocks.length > 0 && random(4) === 0) {
          const staged = blocks[random(blocks.length)] as Block;
          index = indexAfter(staged, index, doc);
          blocks = blocksAfterStaging(blocks, staged);
        } else {
          // Replace some lines, as an edit to the document's text would.
          const from = random(doc.length);
          const to = Math.min(doc.length, from + 1 + random(3));
          const put = someLines(1 + random(3));
          doc = [...doc.slice(0, from), ...put, ...doc.slice(to)];
          blocks = updateBlocks(blocks, index, doc, {
            from,
            to,
            length: put.length,
          });
        }
        expectDescribes(blocks, index, doc);
      }
    }
  });

  test("leaves the changes away from an edit as they were", () => {
    const index = lines("a\n\nb\n\nc\n\nd");
    let doc = lines("A\n\nb\n\nC\n\nD");
    const blocks = buildBlocks(index, doc);
    doc = lines("A\n\nb\n\nCC\n\nD");
    const after = updateBlocks(blocks, index, doc, {
      from: 4,
      to: 5,
      length: 1,
    });
    expectDescribes(after, index, doc);
    expect(after[0]).toBe(blocks[0] as Block);
    expect(after[2]).toBe(blocks[2] as Block);
  });

  test("moves the changes after an edit with the lines it puts in", () => {
    const index = lines("a\n\nb\n\nc");
    let doc = lines("A\n\nb\n\nC");
    const blocks = buildBlocks(index, doc);
    doc = lines("A\nnew\n\nb\n\nC");
    const after = updateBlocks(blocks, index, doc, {
      from: 0,
      to: 1,
      length: 2,
    });
    expectDescribes(after, index, doc);
    expect(after.map(blockKey)).toEqual(["0:1:0:2", "4:5:5:6"]);
  });

  test("finds a change the edit undid, and one it made", () => {
    const index = lines("a\nb\nc");
    const blocks = buildBlocks(index, lines("a\nB\nc"));
    expect(
      updateBlocks(blocks, index, lines("a\nb\nc"), {
        from: 1,
        to: 2,
        length: 1,
      }),
    ).toEqual([]);
    const made = updateBlocks([], index, lines("a\nb\nC"), {
      from: 2,
      to: 3,
      length: 1,
    });
    expect(made.map(blockKey)).toEqual(["2:3:2:3"]);
  });
});

describe("blocksAfterStaging", () => {
  test("drops the staged change and moves the later ones in the index", () => {
    const index = lines("a\n\nb\n\nc");
    const doc = lines("a\nx\ny\n\nB\n\nc\nz");
    const blocks = buildBlocks(index, doc);
    const staged = blocks[0] as Block;
    const after = blocksAfterStaging(blocks, staged);
    const newIndex = indexAfter(staged, index, doc);
    expectDescribes(after, newIndex, doc);
    expect(after).toEqual(buildBlocks(newIndex, doc));
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
