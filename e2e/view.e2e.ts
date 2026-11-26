import { expect, test } from "./demo.ts";

test("lines are numbered by source line, once per line", async ({ demo }) => {
  await demo.open("long-lines");
  const numbers = demo.page.locator(".sg-numbers .sg-number");
  // The long paragraph on line 3 wraps, and is still followed by 4.
  const shown = await numbers.allTextContents();
  expect(shown.slice(1, 6)).toEqual(["1", "2", "3", "4", "5"]);
  const paragraph = await demo.line("A paragraph is usually").boundingBox();
  const title = await demo.line("Long lines").boundingBox();
  expect(paragraph?.height).toBeGreaterThan((title?.height ?? 0) * 2);
});

test("the gutter is three digits wide, widens, and never narrows", async ({
  demo,
}) => {
  await demo.open("basics");
  await demo.setText("one\ntwo");
  const gutter = demo.page.locator(".sg-numbers");
  const narrow = (await gutter.boundingBox())?.width ?? 0;
  const spacer = demo.page.locator(".sg-numbers .cm-gutterElement").first();
  await expect(spacer).toHaveText("000");
  await demo.setText(`${"line\n".repeat(1200)}end`);
  await expect(spacer).toHaveText("0000");
  const wide = (await gutter.boundingBox())?.width ?? 0;
  expect(wide).toBeGreaterThan(narrow);
  await demo.setText("one\ntwo");
  await expect(spacer).toHaveText("0000");
  expect((await gutter.boundingBox())?.width).toBe(wide);
});

test("the cursor's line number stands out while the editor has focus", async ({
  demo,
}) => {
  await demo.open("basics");
  await demo.setText("one\ntwo\nthree", 5);
  const colour = (n: number) =>
    demo.page
      .locator(".sg-numbers .cm-gutterElement", { hasText: String(n) })
      .evaluate((element) => getComputedStyle(element).color);
  const muted = await colour(1);
  expect(await colour(2)).not.toBe(muted);
  await demo.page.evaluate(() =>
    (document.activeElement as HTMLElement).blur(),
  );
  await expect.poll(() => colour(2)).toBe(muted);
});

test("line numbers can be turned off", async ({ demo }) => {
  await demo.open("basics");
  await expect(demo.page.locator(".sg-numbers")).toBeVisible();
  await demo.page.getByRole("checkbox", { name: "Line numbers" }).uncheck();
  await expect(demo.page.locator(".sg-numbers")).toHaveCount(0);
});

test("a heading's number sits on the heading's baseline", async ({ demo }) => {
  await demo.open("basics");
  await demo.setText("text\n\n# Heading\n", 0);
  const bottoms = await demo.page.evaluate(() => {
    const bottom = (node: Node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return range.getBoundingClientRect().bottom;
    };
    const heading = document.querySelector(".sg-h1") as Element;
    const number = [...document.querySelectorAll(".sg-number")].find(
      (element) => element.textContent === "3",
    ) as Element;
    return {
      heading: bottom(heading),
      number: bottom(number.lastChild as Node),
    };
  });
  // Text of different sizes on one baseline has bottoms a few pixels apart, not a row apart.
  expect(Math.abs(bottoms.heading - bottoms.number)).toBeLessThan(12);
});

test("a table is drawn a row per source line", async ({ demo }) => {
  await demo.open("basics");
  await demo.setText(
    "intro\n\n| a | b |\n|---|--:|\n| 1 | *2* |\n| 3 | 4 |\n\nend\n",
    0,
  );
  await expect(demo.page.locator(".sg-row")).toHaveCount(4);
  await expect(demo.page.locator(".sg-row-delimiter")).toHaveCount(1);
  const numbers = await demo.page
    .locator(".sg-numbers .sg-number")
    .allTextContents();
  expect(numbers.slice(1)).toEqual([
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
  ]);
  // Columns line up from row to row.
  const lefts = await demo.page
    .locator(".sg-row:not(.sg-row-delimiter) .sg-cell:nth-child(2)")
    .evaluateAll((cells) => cells.map((c) => c.getBoundingClientRect().left));
  expect(new Set(lefts).size).toBe(1);
  await expect(demo.page.locator(".sg-row .sg-em")).toHaveText("2");
});

test("clicking a table shows the whole table's source", async ({ demo }) => {
  await demo.open("basics");
  await demo.setText("intro\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nend\n", 0);
  await demo.page.locator(".sg-cell", { hasText: "2" }).click();
  await expect(demo.page.locator(".sg-row")).toHaveCount(0);
  await expect(demo.page.locator(".sg-table-source")).toHaveCount(3);
  const head = await demo.page.evaluate(
    () => window.sigil.editor.view.state.selection.main.head,
  );
  expect(head).toBe("intro\n\n| a | b |\n|---|---|\n| 1 | ".length);
  await demo.cursor(0);
  await expect(demo.page.locator(".sg-row")).toHaveCount(3);
});

test("a fenced block shows its fences when the cursor is in it", async ({
  demo,
}) => {
  await demo.open("basics");
  await demo.setText("intro\n\n```js\nlet x;\n```\n\nend\n", 0);
  await expect(demo.page.locator(".sg-code-line")).toHaveCount(3);
  await expect(demo.page.locator(".sg-code-line").first()).toHaveText("js");
  await demo.cursorAfter("let");
  await expect(demo.page.locator(".sg-code-line").first()).toHaveText("```js");
  await expect(demo.page.locator(".sg-code-line").last()).toHaveText("```");
});

test("a fenced block's code is coloured by its language, in either theme", async ({
  demo,
}) => {
  await demo.open("basics");
  await demo.setText('intro\n\n```js\nlet x = "s";\n```\n\nend\n', 0);
  const colour = (selector: string) =>
    demo.page
      .locator(selector)
      .first()
      .evaluate((element) => getComputedStyle(element).color);
  const colours = async () => [
    await colour(".sg-code-line .sg-mono"),
    await colour(".sg-tok-keyword"),
    await colour(".sg-tok-string"),
  ];
  const light = await colours();
  expect(new Set(light).size).toBe(3);
  await demo.page.getByRole("radio", { name: "Dark" }).check();
  await expect(demo.page.locator(".cm-editor")).toHaveClass(/sg-dark/);
  const dark = await colours();
  expect(new Set(dark).size).toBe(3);
  expect(dark[1]).not.toBe(light[1]);
});

test("a language's grammar is fetched when a fence first names it", async ({
  demo,
}) => {
  await demo.open("tables");
  const scripts = () =>
    demo.page.evaluate(
      () =>
        performance
          .getEntriesByType("resource")
          .filter((entry) => entry.name.endsWith(".js")).length,
    );
  const before = await scripts();
  await demo.setText("intro\n\n```erlang\nf() -> ok.\n```\n", 0);
  await expect(demo.page.locator(".sg-tok-literal")).toHaveText("ok");
  expect(await scripts()).toBeGreaterThan(before);
});

test("front matter is folded behind a row that names its lines", async ({
  demo,
}) => {
  await demo.open("front-matter");
  const fold = demo.page.locator(".sg-fold");
  await expect(fold).toHaveText("front matter, lines 1–9");
  const numbers = demo.page.locator(".sg-numbers .sg-number");
  expect((await numbers.allTextContents()).slice(1, 4)).toEqual([
    "1",
    "10",
    "11",
  ]);
  await fold.click();
  await expect(demo.line("title: Front matter")).toBeVisible();
  expect((await numbers.allTextContents()).slice(1, 4)).toEqual([
    "1",
    "2",
    "3",
  ]);
  await demo.page.locator(".sg-fold-open").click();
  await expect(demo.page.locator(".sg-fold")).toHaveText(
    "front matter, lines 1–9",
  );
});

test("a fenced quote and a marked quote both carry a bar", async ({ demo }) => {
  await demo.open("basics");
  await demo.setText(
    "intro\n\n> marked\n\n>>>\nfenced\n\nstill fenced\n>>>\n\nend\n",
    0,
  );
  await expect(demo.page.locator(".sg-quote")).toHaveCount(6);
  await expect(demo.line("still fenced").locator(".sg-quote")).toHaveCount(1);
  await expect(demo.line("end").locator(".sg-quote")).toHaveCount(0);
});

test("bullets keep the difference between their markers", async ({ demo }) => {
  await demo.open("basics");
  await demo.setText("intro\n\n* star\n\n- dash\n\n+ plus\n", 0);
  expect(await demo.page.locator(".sg-bullet").allTextContents()).toEqual([
    "• ",
    "– ",
    "+ ",
  ]);
});

test("the theme follows the browser's colour scheme unless it is set", async ({
  demo,
}) => {
  await demo.page.emulateMedia({ colorScheme: "light" });
  await demo.open("basics");
  const editor = demo.page.locator(".cm-editor");
  await expect(editor).toHaveClass(/sg-light/);
  await demo.page.emulateMedia({ colorScheme: "dark" });
  await expect(editor).toHaveClass(/sg-dark/);
  await demo.page.getByRole("radio", { name: "Light" }).check();
  await expect(editor).toHaveClass(/sg-light/);
  await demo.page.getByRole("radio", { name: "Dark" }).check();
  await demo.page.emulateMedia({ colorScheme: "light" });
  await expect(editor).toHaveClass(/sg-dark/);
  // The page's own bar follows the same setting.
  await expect(demo.page.locator(".bar")).toHaveCSS(
    "background-color",
    "rgb(24, 24, 24)",
  );
});

test("the margin rule runs the full height of the view", async ({ demo }) => {
  await demo.open("basics");
  await demo.setText("one line");
  const heights = await demo.page.evaluate(() => {
    const gutters = document.querySelector(".cm-gutters") as HTMLElement;
    const scroller = document.querySelector(".cm-scroller") as HTMLElement;
    return {
      gutters: gutters.getBoundingClientRect().height,
      scroller: scroller.getBoundingClientRect().height,
      image: getComputedStyle(gutters).backgroundImage,
    };
  });
  expect(heights.gutters).toBe(heights.scroller);
  expect(heights.image).toContain("linear-gradient");
});

test("nothing animates", async ({ demo }) => {
  await demo.open("changes");
  const animated = await demo.page.evaluate(
    () =>
      [...document.querySelectorAll(".cm-editor, .cm-editor *")].filter(
        (element) => {
          const style = getComputedStyle(element);
          return (
            style.animationName !== "none" ||
            style.transitionDuration
              .split(",")
              .some((duration) => Number.parseFloat(duration) > 0)
          );
        },
      ).length,
  );
  expect(animated).toBe(0);
});

test("misspellings are marked, except in code and addresses", async ({
  demo,
}) => {
  await demo.open("basics");
  await demo.setText(
    "intro\n\nIt is teh best, `teh code`, https://example.com/teh\n",
    0,
  );
  const marks = demo.page.locator(".sg-misspelt");
  await expect(marks).toHaveCount(1);
  await expect(marks).toHaveText("teh");
});

test("a misspelling can be added to the dictionary", async ({ demo }) => {
  await demo.open("basics");
  await demo.setText("intro\n\nI recieve teh post and teh news\n", 0);
  const marks = demo.page.locator(".sg-misspelt");
  await expect(marks).toHaveCount(3);
  await marks.nth(1).click({ button: "right" });
  const item = demo.page.locator(".sg-menu-item");
  await expect(item).toHaveText("Add “teh” to dictionary");
  await item.click();
  await expect(demo.page.locator(".sg-menu")).toHaveCount(0);
  await expect(marks).toHaveCount(1);
  expect(await demo.page.evaluate(() => window.sigil.words)).toEqual(["teh"]);
});

test("the manuscript opens, scrolls and takes typing", async ({ demo }) => {
  await demo.open("manuscript");
  const length = (await demo.text()).length;
  expect(length).toBeGreaterThan(450_000);
  await demo.cursor(length);
  const started = Date.now();
  await demo.page.keyboard.type("The end of it all.");
  expect(Date.now() - started).toBeLessThan(5000);
  expect((await demo.text()).endsWith("The end of it all.")).toBe(true);
  await expect(demo.line("The end of it all.")).toBeVisible();
});
