import { describe, expect, test } from "bun:test";
import { Text } from "@codemirror/state";
import { frontMatterEnd, parseText } from "../markdown/parser.ts";
import { renderInline, renderLines, type Tint, widgetDOM } from "./dom.ts";

/** The lines of a text rendered with no syntax shown, as HTML. */
function html(source: string, tints: Tint[] = []): string[] {
  const doc = Text.of(source.split("\n"));
  const src = { doc, tree: parseText(doc), frontMatterTo: frontMatterEnd(doc) };
  return renderLines(src, 1, doc.lines, tints, document).map(
    (line) => line.outerHTML,
  );
}

describe("renderLines", () => {
  test("renders inline formatting with its syntax left out", () => {
    expect(html("a *b* and **c `d`**")).toEqual([
      '<div class="sg-line">a <span class="sg-em">b</span> and <span class="sg-strong">c <span class="sg-code">d</span></span></div>',
    ]);
  });

  test("renders a heading with its size on its text", () => {
    expect(html("## Title")).toEqual([
      '<div class="sg-line sg-heading sg-heading-2"><span class="sg-h sg-h2">Title</span></div>',
    ]);
  });

  test("renders a link with its address as a title", () => {
    expect(html("[text](http://a.b)")).toEqual([
      '<div class="sg-line"><span class="sg-link" title="http://a.b">text</span></div>',
    ]);
  });

  test("gives an empty line a break, so that it has a row", () => {
    expect(html("a\n\nb")[1]).toBe('<div class="sg-line"><br></div>');
  });

  test("renders a list item with its marker boxed and its text hung", () => {
    const [first, second] = html("- one\n  1. two");
    expect(first).toBe(
      '<div class="sg-line sg-nested" style="padding-left: calc(var(--sg-pad) + 1.6em); text-indent: -1.6em;"><span class="sg-box sg-marker sg-bullet" aria-hidden="true">– </span>one</div>',
    );
    expect(second).toContain(
      '<span class="sg-box" style="width: 1.6em;">  </span><span class="sg-box sg-marker sg-ordered">1. </span>two',
    );
  });

  test("renders a quote's bar, and a fenced quote's", () => {
    expect(html("> a")[0]).toContain(
      '<span class="sg-box sg-quote sg-unseen">&gt; </span>a',
    );
    const fenced = html(">>>\n*a*\n>>>");
    expect(fenced[0]).toContain('<span class="sg-box sg-quote"></span>');
    expect(fenced[1]).toContain(
      '<span class="sg-box sg-quote"></span><span class="sg-em">a</span>',
    );
  });

  test("renders a task with a box", () => {
    const [open, done] = html("- [ ] a\n- [x] b");
    expect(open).toContain(
      '<span class="sg-task" role="checkbox" aria-checked="false"></span> a',
    );
    expect(done).toContain('class="sg-task sg-task-checked"');
    expect(done).toContain('<span class="sg-done"> b</span>');
  });

  test("renders a table a row per line, with the same columns in each", () => {
    const rows = html("| a | *b* |\n|---|--:|\n| 1 | 2 |");
    expect(rows.length).toBe(3);
    const columns = rows.map(
      (row) => /grid-template-columns: ([^;]+);/.exec(row)?.[1],
    );
    expect(columns[0]).toContain("minmax(min(");
    expect(new Set(columns).size).toBe(1);
    expect(rows[0]).toContain('class="sg-row sg-row-header"');
    expect(rows[0]).toContain('<span class="sg-em">b</span>');
    expect(rows[0]).toContain("text-align: right;");
    expect(rows[1]).toContain('class="sg-row sg-row-delimiter"');
    expect(rows[2]).toContain('data-offset="2"');
  });

  test("renders a picture and a rule", () => {
    expect(html("![alt](pic.png)")[0]).toContain(
      '<img class="sg-image" alt="alt" title="alt" src="pic.png">',
    );
    expect(html("a\n\n---")[2]).toContain('<span class="sg-rule"></span>');
  });

  test("renders code and front matter in monospace", () => {
    expect(html("```js\nx\n```")).toEqual([
      '<div class="sg-line sg-code-line sg-code-first"><span class="sg-mono"><span class="sg-code-info">js</span></span></div>',
      '<div class="sg-line sg-code-line"><span class="sg-mono">x</span></div>',
      '<div class="sg-line sg-code-line sg-code-last"><span class="sg-mono"></span><br></div>',
    ]);
    expect(html("---\na: 1\n---")[1]).toBe(
      '<div class="sg-line sg-front-matter"><span class="sg-mono">a: 1</span></div>',
    );
  });

  test("renders only the lines asked for", () => {
    const doc = Text.of(["*a*", "*b*", "*c*"]);
    const src = { doc, tree: parseText(doc), frontMatterTo: 0 };
    const lines = renderLines(src, 2, 2, [], document);
    expect(lines.map((line) => line.textContent)).toEqual(["b"]);
  });
});

describe("renderInline", () => {
  const render = (text: string, tints: Tint[]) => {
    const holder = document.createElement("div");
    holder.append(renderInline(text, 10, [], tints, document));
    return holder.innerHTML;
  };

  test("lays tints over the text, in the positions the text is at", () => {
    expect(render("one two", [{ from: 14, to: 17, cls: "x" }])).toBe(
      'one <span class="x">two</span>',
    );
  });

  test("lets tints overlap", () => {
    expect(
      render("abcdef", [
        { from: 10, to: 14, cls: "x" },
        { from: 12, to: 16, cls: "y" },
      ]),
    ).toBe(
      '<span class="x">ab</span><span class="x y">cd</span><span class="y">ef</span>',
    );
  });
});

test("every kind of widget has its element", () => {
  expect(widgetDOM({ type: "rule" }, document).className).toBe("sg-rule");
  expect(widgetDOM({ type: "bar" }, document).className).toBe(
    "sg-box sg-quote",
  );
  expect(widgetDOM({ type: "bullet", glyph: "•" }, document).textContent).toBe(
    "• ",
  );
  expect(
    widgetDOM({ type: "task", checked: true }, document).getAttribute(
      "aria-checked",
    ),
  ).toBe("true");
});
