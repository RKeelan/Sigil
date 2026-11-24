import { describe, expect, test } from "bun:test";
import { Text } from "@codemirror/state";
import {
  documentType,
  frontMatterEnd,
  markdownParser,
  parseText,
} from "./parser.ts";

/** The names of the nodes a text parses to, with their extents. */
function nodes(text: string): string[] {
  const out: string[] = [];
  markdownParser.parse(text).iterate({
    enter(node) {
      out.push(`${node.name} ${node.from}-${node.to}`);
    },
  });
  return out;
}

describe("fenced quotes", () => {
  test("open and close with >>> on a line of its own", () => {
    expect(nodes("before\n>>>\nquoted\n>>>\nafter")).toEqual([
      "Document 0-27",
      "Paragraph 0-6",
      "FencedQuote 7-21",
      "QuoteFence 7-10",
      "Paragraph 11-17",
      "QuoteFence 18-21",
      "Paragraph 22-27",
    ]);
  });

  test("hold blocks, without a mark on every line", () => {
    const found = nodes(">>>\nfirst\n\n- item\n\n```\ncode\n```\n>>>");
    expect(found).toContain("FencedQuote 0-35");
    expect(found).toContain("BulletList 11-17");
    expect(found).toContain("FencedCode 19-31");
  });

  test("run to the end of the document when never closed", () => {
    expect(nodes(">>>\nopen\n\nstill")).toContain("FencedQuote 0-15");
  });

  test("can follow one another", () => {
    const found = nodes(">>>\na\n>>>\n>>>\nb\n>>>\nend");
    expect(found).toContain("FencedQuote 0-9");
    expect(found).toContain("FencedQuote 10-19");
    expect(found).toContain("Paragraph 20-23");
  });

  test("nest inside a list item", () => {
    const found = nodes("- item\n  >>>\n  in\n  >>>\n- two");
    expect(found).toContain("FencedQuote 9-23");
    expect(found).toContain("ListItem 24-29");
  });

  test("need the fence to be alone on its line", () => {
    const found = nodes(">>> text");
    expect(found.some((node) => node.startsWith("FencedQuote"))).toBe(false);
    expect(found.filter((node) => node.startsWith("Blockquote")).length).toBe(
      3,
    );
  });

  test("are not opened by an indented code line", () => {
    const found = nodes("para\n\n    >>>\n");
    expect(found.some((node) => node.startsWith("FencedQuote"))).toBe(false);
  });
});

describe("GitHub's extensions", () => {
  test("tables, tasks, strikethrough and bare links are parsed", () => {
    const found = nodes("| a |\n|---|\n| 1 |\n\n- [x] ~~done~~ https://x.y");
    expect(found.some((node) => node.startsWith("Table "))).toBe(true);
    expect(found.some((node) => node.startsWith("TaskMarker"))).toBe(true);
    expect(found.some((node) => node.startsWith("Strikethrough "))).toBe(true);
    expect(found.some((node) => node.startsWith("URL"))).toBe(true);
  });

  test("a list directly follows a paragraph", () => {
    expect(nodes("para\n- one\n- two")).toContain("BulletList 5-16");
  });
});

describe("fenced code", () => {
  /** The innermost node at a position, in the code's tree and in the document's. */
  function at(text: string, pos: number): [string, string] {
    const tree = parseText(Text.of(text.split("\n")));
    return [tree.resolveInner(pos, 1).name, tree.resolve(pos, 1).name];
  }

  test("is parsed in its language, in a tree mounted over the code", () => {
    expect(at("```js\nlet x;\n```", 6)).toEqual(["let", "CodeText"]);
  });

  test("is left as text when its language isn't known", () => {
    expect(at("```nonesuch\nlet x;\n```", 12)).toEqual([
      "CodeText",
      "CodeText",
    ]);
  });

  test("in Markdown has a top node of its own", () => {
    const tree = parseText(Text.of(["```md", "# a", "```"]));
    let node = tree.resolveInner(8, 1);
    while (node.parent && node.parent.name !== "FencedCode") node = node.parent;
    expect(node.type.isTop).toBe(true);
    expect(node.type).not.toBe(documentType);
    expect(tree.type).toBe(documentType);
  });
});

describe("front matter", () => {
  const end = (text: string) => frontMatterEnd(Text.of(text.split("\n")));

  test("runs from --- on the first line to the next --- or ...", () => {
    expect(end("---\na: 1\n---\ntext")).toBe(12);
    expect(end("---\na: 1\n...\ntext")).toBe(12);
    expect(end("---\n---")).toBe(7);
  });

  test("is not found when the block is never closed", () => {
    expect(end("---\na: 1\ntext")).toBe(0);
    expect(end("---")).toBe(0);
  });

  test("is not found below the first line", () => {
    expect(end("text\n---\na: 1\n---")).toBe(0);
    expect(end("")).toBe(0);
  });
});

test("a text's tree is parsed once", () => {
  const text = Text.of(["# Title", "", "para"]);
  const tree = parseText(text);
  expect(tree.length).toBe(text.length);
  expect(parseText(text)).toBe(tree);
});
