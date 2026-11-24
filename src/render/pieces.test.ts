import { describe, expect, test } from "bun:test";
import { Text } from "@codemirror/state";
import { frontMatterEnd, parseText } from "../markdown/parser.ts";
import { buildPieces, type Piece, type Reveal } from "./pieces.ts";

const everything: Reveal = () => true;

/** The pieces for a text, each written as a short string. */
function pieces(source: string, reveal?: Reveal): string[] {
  const doc = Text.of(source.split("\n"));
  const built = buildPieces(
    { doc, tree: parseText(doc), frontMatterTo: frontMatterEnd(doc) },
    0,
    doc.length,
    reveal,
  );
  return built.map(describePiece);
}

function describePiece(piece: Piece): string {
  switch (piece.kind) {
    case "line":
      return `line ${piece.at} ${piece.cls}${piece.style ? ` {${piece.style}}` : ""}`;
    case "mark":
      return `mark ${piece.from}-${piece.to} ${piece.cls}${
        piece.attrs ? ` ${JSON.stringify(piece.attrs)}` : ""
      }`;
    case "hide":
      return `hide ${piece.from}-${piece.to}`;
    case "widget":
      return `widget ${piece.from}-${piece.to} ${
        piece.spec.type === "row"
          ? `row:${piece.spec.kind}:${piece.spec.cells.map((cell) => cell.text).join(",")}`
          : JSON.stringify(piece.spec)
      }`;
  }
}

describe("inline syntax", () => {
  test("is hidden, and its text marked", () => {
    expect(pieces("a *b* **c** ~~d~~ `e`")).toEqual([
      "mark 2-5 sg-em",
      "hide 2-3",
      "hide 4-5",
      "mark 6-11 sg-strong",
      "hide 6-8",
      "hide 9-11",
      "mark 12-17 sg-strike",
      "hide 12-14",
      "hide 15-17",
      "mark 18-21 sg-code",
      "hide 18-19",
      "hide 20-21",
    ]);
  });

  test("is muted where it is shown", () => {
    expect(pieces("a *b*", everything)).toEqual([
      "mark 2-5 sg-em",
      "mark 2-3 sg-syntax",
      "mark 4-5 sg-syntax",
    ]);
  });

  test("is shown only on the lines that are revealed", () => {
    const second: Reveal = (from, to) => from <= 8 && to >= 4;
    expect(pieces("*a*\n*b*", second)).toEqual([
      "mark 0-3 sg-em",
      "hide 0-1",
      "hide 2-3",
      "mark 4-7 sg-em",
      "mark 4-5 sg-syntax",
      "mark 6-7 sg-syntax",
    ]);
  });

  test("a link keeps its text and hides its address", () => {
    expect(pieces('[text](http://a.b "t")')).toEqual([
      'mark 1-5 sg-link {"title":"http://a.b"}',
      "hide 0-1",
      "hide 5-22",
    ]);
    expect(pieces("[text][ref]")).toEqual([
      "mark 1-5 sg-link",
      "hide 0-1",
      "hide 5-11",
    ]);
  });

  test("a bracketed phrase with no address is left alone", () => {
    expect(pieces("see [sic] here")).toEqual([]);
  });

  test("addresses are linked, with their brackets hidden", () => {
    expect(pieces("<http://a.b> http://c.d")).toEqual([
      "hide 0-1",
      "hide 11-12",
      "mark 1-11 sg-link",
      "mark 13-23 sg-link",
    ]);
  });

  test("a picture takes the place of its source", () => {
    expect(pieces("![alt](pic.png)")).toEqual([
      'widget 0-15 {"type":"image","src":"pic.png","alt":"alt"}',
    ]);
  });

  test("a picture stays below its source while the source is shown", () => {
    expect(pieces("![alt](pic.png)", everything)).toEqual([
      "mark 0-15 sg-syntax",
      'widget 15-15 {"type":"image","src":"pic.png","alt":"alt"}',
    ]);
  });

  test("an escape hides its backslash, and a hard break's is muted", () => {
    expect(pieces("\\*x\\\ny")).toEqual(["hide 0-1", "mark 3-4 sg-syntax"]);
  });

  test("HTML and comments are marked as they are", () => {
    expect(pieces("a <b>c</b> <!-- d -->")).toEqual([
      "mark 2-5 sg-html",
      "mark 6-10 sg-html",
      "mark 11-21 sg-html",
    ]);
  });
});

describe("headings", () => {
  test("carry their size on their text and hide their marks", () => {
    expect(pieces("## Title ##")).toEqual([
      "line 0 sg-heading sg-heading-2",
      "mark 0-11 sg-h sg-h2",
      "hide 0-3",
      "hide 8-11",
    ]);
  });

  test("keep their size when their marks are shown", () => {
    expect(pieces("# T", everything)).toEqual([
      "line 0 sg-heading sg-heading-1",
      "mark 0-3 sg-h sg-h1",
      "mark 0-1 sg-syntax",
    ]);
  });

  test("underlined ones keep the underline as a row", () => {
    expect(pieces("Title\n=====")).toEqual([
      "line 0 sg-heading sg-heading-1",
      "mark 0-5 sg-h sg-h1",
      "line 6 sg-setext",
      "mark 6-11 sg-syntax",
    ]);
  });
});

describe("blocks", () => {
  test("a rule is drawn in place of its source", () => {
    expect(pieces("a\n\n---")).toEqual(['widget 3-6 {"type":"rule"}']);
    expect(pieces("a\n\n---", everything)).toEqual(["mark 3-6 sg-syntax"]);
  });

  test("a fenced block keeps a row for each fence", () => {
    expect(pieces("```js\nlet x;\n```")).toEqual([
      "line 0 sg-code-line sg-code-first",
      "line 6 sg-code-line",
      "line 13 sg-code-line sg-code-last",
      "hide 0-3",
      "mark 3-5 sg-code-info",
      "hide 13-16",
      "mark 6-9 sg-tok-keyword",
      "mark 0-5 sg-mono",
      "mark 6-12 sg-mono",
      "mark 13-16 sg-mono",
    ]);
  });

  test("a fenced block shows its fences as a whole", () => {
    const inside: Reveal = (from, to) => from <= 8 && to >= 8;
    expect(pieces("```\nx\n```", inside)).toContain("mark 0-3 sg-syntax");
    expect(pieces("```\nx\n```", inside)).toContain("mark 6-9 sg-syntax");
  });

  test("an indented block is set as code", () => {
    expect(pieces("a\n\n    code")).toEqual([
      "line 3 sg-code-line sg-code-first sg-code-last",
      "mark 3-11 sg-mono",
    ]);
  });

  test("an HTML block and a link definition are shown as written", () => {
    expect(pieces("<div>\nx\n</div>\n\n[a]: http://b.c")).toEqual([
      "line 0 sg-html-line",
      "line 6 sg-html-line",
      "line 8 sg-html-line",
      "mark 16-31 sg-syntax",
      "mark 0-5 sg-mono",
      "mark 6-7 sg-mono",
      "mark 8-14 sg-mono",
    ]);
  });

  test("front matter is set apart, and not read as Markdown", () => {
    expect(pieces("---\n# not a heading\n---\n\n# heading")).toEqual([
      "line 25 sg-heading sg-heading-1",
      "mark 25-34 sg-h sg-h1",
      "hide 25-27",
      "line 0 sg-front-matter",
      "mark 0-3 sg-mono",
      "line 4 sg-front-matter",
      "mark 4-19 sg-mono",
      "line 20 sg-front-matter",
      "mark 20-23 sg-mono",
    ]);
  });
});

describe("code in a fenced block", () => {
  /** The highlighted tokens of a text, each with its text. */
  function tokens(source: string, from = 0, to = source.length): string[] {
    const doc = Text.of(source.split("\n"));
    return buildPieces(
      { doc, tree: parseText(doc), frontMatterTo: 0 },
      from,
      to,
    )
      .filter((piece) => piece.kind === "mark" && piece.cls.includes("sg-tok"))
      .map((piece) =>
        piece.kind === "mark"
          ? `${doc.sliceString(piece.from, piece.to)} ${piece.cls}`
          : "",
      );
  }

  test("is highlighted in the language its info string names", () => {
    expect(tokens('```ts title="x"\nf("s", 1) // c\n```')).toEqual([
      "f sg-tok-function",
      '"s" sg-tok-string',
      "1 sg-tok-literal",
      "// c sg-tok-comment",
    ]);
    expect(tokens("```Python\ndef f(): return None\n```")).toEqual([
      "def sg-tok-keyword",
      "f sg-tok-function",
      "return sg-tok-keyword",
      "None sg-tok-literal",
    ]);
  });

  test("is highlighted in languages defined by stream parsers", () => {
    expect(tokens('```sh\necho "hi" # c\n```')).toEqual([
      "echo sg-tok-function",
      '"hi" sg-tok-string',
      "# c sg-tok-comment",
    ]);
    expect(tokens("```diff\n-a\n+b\n```")).toEqual([
      "-a sg-tok-deleted",
      "+b sg-tok-inserted",
    ]);
  });

  test("is marked a line at a time where a token spans lines", () => {
    expect(tokens("```js\n/* a\nb */\n```")).toEqual([
      "/* a sg-tok-comment",
      "b */ sg-tok-comment",
    ]);
  });

  test("is left alone when its language isn't known or isn't given", () => {
    expect(tokens("```nonesuch\nlet x;\n```")).toEqual([]);
    expect(tokens("```\nlet x;\n```")).toEqual([]);
    expect(tokens("a\n\n    let x;")).toEqual([]);
  });

  test("is highlighted inside a quote or a list item", () => {
    expect(tokens("> ```js\n> let x;\n> ```")).toEqual(["let sg-tok-keyword"]);
    expect(tokens("- a\n\n  ```js\n  let x;\n  ```")).toEqual([
      "let sg-tok-keyword",
    ]);
  });

  test("is highlighted only on the lines asked for", () => {
    const source = "```js\nlet a;\nlet b;\n```";
    expect(tokens(source, 13, 13)).toEqual(["let sg-tok-keyword"]);
  });

  test("in Markdown is highlighted and not rendered", () => {
    const source = "~~~md\n# T\n- a\n> q\n```js\nlet x;\n```\n~~~";
    expect(tokens(source)).toContain(" T sg-tok-heading");
    expect(tokens(source)).toContain("let sg-tok-keyword");
    const rendered = pieces(source);
    expect(rendered.some((piece) => piece.includes("bullet"))).toBe(false);
    expect(rendered.some((piece) => piece.includes("sg-nested"))).toBe(false);
    expect(rendered.some((piece) => piece.includes("sg-h1"))).toBe(false);
  });
});

describe("tables", () => {
  const table = "| a | *b* |\n|:--|--:|\n| 1 |  |\n| 22 | 3 |";

  test("are drawn a row per source line, the delimiter row included", () => {
    expect(pieces(table)).toEqual([
      "widget 0-11 row:header:a,*b*",
      "widget 22-30 row:body:1,",
      "widget 31-41 row:body:22,3",
      "widget 12-21 row:delimiter:",
    ]);
  });

  test("give every row the same columns", () => {
    const doc = Text.of(table.split("\n"));
    const rows = buildPieces(
      { doc, tree: parseText(doc), frontMatterTo: 0 },
      0,
      doc.length,
    ).flatMap((piece) =>
      piece.kind === "widget" && piece.spec.type === "row" ? [piece.spec] : [],
    );
    expect(rows.length).toBe(4);
    for (const row of rows) {
      expect(row.aligns).toEqual(["left", "right"]);
      expect(row.widths).toEqual(rows[0]?.widths as number[]);
    }
    // The second column is as wide as "b" set bold, which the hidden asterisks don't add to.
    expect(rows[0]?.widths[1]).toBeLessThan(rows[0]?.widths[0] as number);
    expect(rows[0]?.cells[1]?.pieces.length).toBe(3);
  });

  test("measure their cells when they can", () => {
    const doc = Text.of(table.split("\n"));
    const measured: string[] = [];
    buildPieces(
      {
        doc,
        tree: parseText(doc),
        frontMatterTo: 0,
        measure: (text, style) => {
          measured.push(`${text}${style.bold ? ":bold" : ""}`);
          return 3;
        },
      },
      0,
      doc.length,
    );
    expect(measured).toContain("a:bold");
    expect(measured).toContain("22");
    expect(measured).not.toContain("*");
  });

  test("show their source as a whole", () => {
    const first: Reveal = (from, to) => from <= 2 && to >= 2;
    expect(pieces(table, first)).toEqual([
      "line 0 sg-table-source",
      "line 12 sg-table-source",
      "line 22 sg-table-source",
      "line 31 sg-table-source",
      "mark 0-11 sg-mono",
      "mark 12-21 sg-mono",
      "mark 22-30 sg-mono",
      "mark 31-41 sg-mono",
    ]);
  });

  test("need no pipes at the edges, and read alignment", () => {
    expect(pieces("a | b\n:-: | ---\nc | d")).toEqual([
      "widget 0-5 row:header:a,b",
      "widget 16-21 row:body:c,d",
      "widget 6-15 row:delimiter:",
    ]);
  });
});

describe("lists and quotes", () => {
  test("a bullet takes the place of its marker, and differs by marker", () => {
    expect(
      pieces("- a\n* b\n+ c").filter((p) => p.startsWith("widget")),
    ).toEqual([
      'widget 0-2 {"type":"bullet","glyph":"–"}',
      'widget 4-6 {"type":"bullet","glyph":"•"}',
      'widget 8-10 {"type":"bullet","glyph":"+"}',
    ]);
  });

  test("a marker is boxed as typed where it is shown, and numbers always", () => {
    expect(pieces("- a", everything)).toEqual([
      "mark 0-2 sg-box sg-marker",
      "line 0 sg-nested {padding-left: calc(var(--sg-pad) + 1.6em); text-indent: -1.6em}",
    ]);
    expect(pieces("12. a")).toEqual([
      "mark 0-4 sg-box sg-marker sg-ordered",
      "line 0 sg-nested {padding-left: calc(var(--sg-pad) + 1.6em); text-indent: -1.6em}",
    ]);
  });

  test("nesting is drawn by depth, whatever the indentation is", () => {
    expect(pieces("- a\n    - b\n      c")).toEqual([
      'widget 0-2 {"type":"bullet","glyph":"–"}',
      "line 0 sg-nested {padding-left: calc(var(--sg-pad) + 1.6em); text-indent: -1.6em}",
      'mark 4-8 sg-box {"style":"width: 1.6em"}',
      'widget 8-10 {"type":"bullet","glyph":"–"}',
      "line 4 sg-nested {padding-left: calc(var(--sg-pad) + 3.2em); text-indent: -3.2em}",
      'mark 12-18 sg-box {"style":"width: 3.2em"}',
      "line 12 sg-nested {padding-left: calc(var(--sg-pad) + 3.2em); text-indent: -3.2em}",
    ]);
  });

  test("a line that isn't indented to its item hangs under the item's text", () => {
    expect(pieces("- a\nlazy")).toContain(
      "line 4 sg-nested {padding-left: calc(var(--sg-pad) + 1.6em); text-indent: -0em}",
    );
  });

  test("a task has a box and no bullet", () => {
    expect(pieces("- [ ] a\n- [x] b")).toEqual([
      'widget 2-5 {"type":"task","checked":false}',
      "mark 13-15 sg-done",
      'widget 10-13 {"type":"task","checked":true}',
      'widget 0-2 {"type":"bullet","glyph":""}',
      "line 0 sg-nested {padding-left: calc(var(--sg-pad) + 1.6em); text-indent: -1.6em}",
      'widget 8-10 {"type":"bullet","glyph":""}',
      "line 8 sg-nested {padding-left: calc(var(--sg-pad) + 1.6em); text-indent: -1.6em}",
    ]);
    expect(pieces("- [ ] a", everything)).toContain("mark 2-5 sg-syntax");
  });

  test("a quote's marks are boxed, unseen until the line is shown", () => {
    expect(pieces("> a\n> > b")).toEqual([
      "mark 0-2 sg-box sg-quote sg-unseen",
      "line 0 sg-nested {padding-left: calc(var(--sg-pad) + 1.2em); text-indent: -1.2em}",
      "mark 4-6 sg-box sg-quote sg-unseen",
      "mark 6-8 sg-box sg-quote sg-unseen",
      "line 4 sg-nested {padding-left: calc(var(--sg-pad) + 2.4em); text-indent: -2.4em}",
    ]);
    expect(pieces("> a", everything)).toContain(
      "mark 0-2 sg-box sg-quote sg-syntax",
    );
  });

  test("a fenced quote has a bar on every line, and hides its fences", () => {
    expect(pieces(">>>\na\n>>>")).toEqual([
      "hide 0-3",
      "hide 6-9",
      'widget 0-0 {"type":"bar"}',
      "line 0 sg-nested {padding-left: calc(var(--sg-pad) + 1.2em); text-indent: -1.2em}",
      'widget 4-4 {"type":"bar"}',
      "line 4 sg-nested {padding-left: calc(var(--sg-pad) + 1.2em); text-indent: -1.2em}",
      'widget 6-6 {"type":"bar"}',
      "line 6 sg-nested {padding-left: calc(var(--sg-pad) + 1.2em); text-indent: -1.2em}",
    ]);
  });

  test("code inside a list item is set in monospace from its own indentation", () => {
    expect(pieces("- a\n\n  ```\n  x\n  ```")).toContain("mark 13-14 sg-mono");
  });
});

test("only the lines asked for are worked out", () => {
  const doc = Text.of(["*a*", "*b*", "*c*"]);
  const built = buildPieces(
    { doc, tree: parseText(doc), frontMatterTo: 0 },
    5,
    5,
  );
  expect(built.map(describePiece)).toEqual([
    "mark 4-7 sg-em",
    "hide 4-5",
    "hide 6-7",
  ]);
});
