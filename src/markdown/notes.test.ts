import { describe, expect, test } from "bun:test";
import { markdownParser } from "./parser.ts";

/** The notes and note marks a text parses to, with their extents. */
function notes(text: string): string[] {
  const out: string[] = [];
  markdownParser.parse(text).iterate({
    enter(node) {
      if (node.name.startsWith("Note"))
        out.push(`${node.name} ${node.from}-${node.to}`);
    },
  });
  return out;
}

describe("notes", () => {
  test("open with a $ and a letter, and close at the next $", () => {
    expect(notes("a $Ann fix this$ b")).toEqual([
      "Note 2-16",
      "NoteMark 2-3",
      "NoteMark 15-16",
    ]);
  });

  test("run to the end of the paragraph when not closed", () => {
    expect(notes("a $Ann fix\nthis\n\nnext")).toEqual([
      "Note 2-15",
      "NoteMark 2-3",
    ]);
  });

  test("open with any letter", () => {
    expect(notes("$édith x$")).toEqual([
      "Note 0-9",
      "NoteMark 0-1",
      "NoteMark 8-9",
    ]);
  });

  test("are not opened by a $ before a digit or space", () => {
    expect(notes("costs $20 and $ 30")).toEqual([]);
  });

  test("end before a $ that opens another note", () => {
    expect(notes("$A one $B two$")).toEqual([
      "Note 0-7",
      "NoteMark 0-1",
      "Note 7-14",
      "NoteMark 7-8",
      "NoteMark 13-14",
    ]);
  });

  test("are not closed by a $ in a code span or escaped", () => {
    expect(notes("$A `x$` \\$ y$")).toEqual([
      "Note 0-13",
      "NoteMark 0-1",
      "NoteMark 12-13",
    ]);
  });

  test("are not opened in a code span or by an escaped $", () => {
    expect(notes("`$A x$` \\$B y")).toEqual([]);
  });

  test("hold inline syntax", () => {
    const found: string[] = [];
    markdownParser.parse("$A *b* c$").iterate({
      enter(node) {
        found.push(node.name);
      },
    });
    expect(found).toContain("Emphasis");
  });

  test("end at the bracket that closes a link they are in", () => {
    expect(notes("[$A x](u)")).toEqual(["Note 1-5", "NoteMark 1-2"]);
  });
});
