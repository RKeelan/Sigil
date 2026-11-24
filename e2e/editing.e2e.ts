import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "./demo.ts";

const samples = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "demo",
  "samples",
);

for (const name of ["basics", "lists", "tables", "code", "front-matter"]) {
  test(`${name}: an edit changes nothing but what was typed`, async ({
    demo,
  }) => {
    const source = readFileSync(join(samples, `${name}.md`), "utf8");
    await demo.open(name);
    expect(await demo.text()).toBe(source);
    const at = source.length - 1;
    await demo.cursor(at);
    await demo.page.keyboard.type("Zq");
    expect(await demo.text()).toBe(
      `${source.slice(0, at)}Zq${source.slice(at)}`,
    );
    const edits = await demo.page.evaluate(() => window.sigil.edits);
    expect(edits).toEqual([
      [{ from: at, to: at, insert: "Z" }],
      [{ from: at + 1, to: at + 1, insert: "q" }],
    ]);
  });
}

test("a document with Windows line endings keeps them", async ({ demo }) => {
  await demo.open("basics");
  // The cursor is placed in the editor's own coordinates, where a line break is one character.
  await demo.setText("one\r\ntwo\r\nthree\r\n", 7);
  await demo.page.evaluate(() => {
    window.sigil.edits.length = 0;
  });
  await demo.page.keyboard.press("Enter");
  await demo.page.keyboard.type("x");
  expect(await demo.text()).toBe("one\r\ntwo\r\nx\r\nthree\r\n");
  // Edits are reported in the coordinates of the text with its line endings: "two" ends at 8.
  expect(await demo.page.evaluate(() => window.sigil.edits)).toEqual([
    [{ from: 8, to: 8, insert: "\r\n" }],
    [{ from: 10, to: 10, insert: "x" }],
  ]);
});

test("a change from outside replaces the text without being reported", async ({
  demo,
}) => {
  await demo.open("basics");
  await demo.setText("alpha beta gamma");
  await demo.page.evaluate(() => {
    window.sigil.edits.length = 0;
    window.sigil.editor.setText("alpha BETA gamma");
  });
  expect(await demo.text()).toBe("alpha BETA gamma");
  expect(await demo.page.evaluate(() => window.sigil.edits)).toEqual([]);
});

test("the syntax of the cursor's line is shown, and of no other", async ({
  demo,
}) => {
  await demo.open("basics");
  await demo.setText("first *one*\n\nsecond **two** and `code`\n", 0);
  await expect(demo.line("first")).toHaveText("first *one*");
  await expect(demo.line("second")).toHaveText("second two and code");
  await demo.cursorAfter("second");
  await expect(demo.line("first")).toHaveText("first one");
  await expect(demo.line("second")).toHaveText("second **two** and `code`");
});

test("clicking a line shows its syntax", async ({ demo }) => {
  await demo.open("basics");
  await demo.setText("first *one*\n\nsecond **two**\n", 0);
  await demo.line("second").click();
  await expect(demo.line("second")).toHaveText("second **two**");
  await expect(demo.line("first")).toHaveText("first one");
});

test("a heading keeps its height when the cursor enters it", async ({
  demo,
}) => {
  await demo.open("basics");
  await demo.setText("text\n\n## Heading\n\nmore\n", 0);
  const before = await demo.line("Heading").boundingBox();
  await demo.cursorAfter("## Head");
  await expect(demo.line("Heading")).toHaveText("## Heading");
  const after = await demo.line("Heading").boundingBox();
  expect(after?.height).toBe(before?.height);
  expect(before?.height).toBeGreaterThan(
    (await demo.line("more").boundingBox())?.height ?? 0,
  );
});

test("a list item's text doesn't move when the cursor enters it", async ({
  demo,
}) => {
  await demo.open("basics");
  await demo.setText("- one\n  - two words\n\n> quoted text\n", 0);
  const left = (text: string) =>
    demo.page.evaluate((needle) => {
      const walker = document.createTreeWalker(
        document.querySelector(".cm-content") as Element,
        NodeFilter.SHOW_TEXT,
      );
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = node.textContent?.indexOf(needle) ?? -1;
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + needle.length);
        return range.getBoundingClientRect().left;
      }
      return -1;
    }, text);
  const two = await left("two words");
  const quoted = await left("quoted text");
  await demo.cursorAfter("two");
  await expect(demo.line("two words")).toHaveText("  - two words");
  expect(await left("two words")).toBe(two);
  await demo.cursorAfter("quoted");
  await expect(demo.line("quoted text")).toHaveText("> quoted text");
  expect(await left("quoted text")).toBe(quoted);
});

test("Enter continues lists and quotes", async ({ demo }) => {
  await demo.open("basics");
  await demo.setText("- one");
  await demo.page.keyboard.press("Enter");
  await demo.page.keyboard.type("two");
  await demo.page.keyboard.press("Enter");
  await demo.page.keyboard.press("Tab");
  await demo.page.keyboard.type("nested");
  await demo.page.keyboard.press("Enter");
  await demo.page.keyboard.press("Enter");
  await demo.page.keyboard.type("three");
  await demo.page.keyboard.press("Enter");
  await demo.page.keyboard.press("Enter");
  await demo.page.keyboard.type("1. first");
  await demo.page.keyboard.press("Enter");
  await demo.page.keyboard.type("second");
  expect(await demo.text()).toBe(
    "- one\n- two\n  - nested\n- three\n1. first\n2. second",
  );
});

test("Shift+Tab outdents and Tab elsewhere types a tab", async ({ demo }) => {
  await demo.open("basics");
  await demo.setText("- one\n  - two");
  await demo.page.keyboard.press("Shift+Tab");
  expect(await demo.text()).toBe("- one\n- two");
  await demo.page.keyboard.press("Tab");
  expect(await demo.text()).toBe("- one\n- two\t");
});

test("Ctrl+Shift+Enter opens a line and leaves the cursor before it", async ({
  demo,
}) => {
  await demo.open("basics");
  await demo.setText("one two", 3);
  await demo.page.keyboard.press("Control+Shift+Enter");
  await demo.page.keyboard.type("X");
  expect(await demo.text()).toBe("oneX\n two");
});

test("undo steps back a word at a time and restores the cursor", async ({
  demo,
}) => {
  await demo.open("basics");
  await demo.setText("start ", 6);
  await demo.page.keyboard.type("one two  three");
  await demo.page.keyboard.press("Control+z");
  expect(await demo.text()).toBe("start one two  ");
  await demo.page.keyboard.press("Control+z");
  expect(await demo.text()).toBe("start one ");
  await demo.page.keyboard.press("Control+z");
  expect(await demo.text()).toBe("start ");
  expect(
    await demo.page.evaluate(
      () => window.sigil.editor.view.state.selection.main.head,
    ),
  ).toBe(6);
  await demo.page.keyboard.press("Control+y");
  expect(await demo.text()).toBe("start one ");
});

test("Alt+Up moves a line and Ctrl+D selects the next occurrence", async ({
  demo,
}) => {
  await demo.open("basics");
  await demo.setText("one\ntwo\none", 5);
  await demo.page.keyboard.press("Alt+ArrowUp");
  expect(await demo.text()).toBe("two\none\none");
  await demo.cursor(5);
  await demo.page.keyboard.press("Control+d");
  await demo.page.keyboard.press("Control+d");
  await demo.page.keyboard.type("x");
  expect(await demo.text()).toBe("two\nx\nx");
});

test("a snippet is offered for its trigger and taken with Tab", async ({
  demo,
}) => {
  await demo.open("basics");
  await demo.setText("Dated ");
  await demo.page.keyboard.type(";date");
  await expect(demo.page.locator(".sg-snippet")).toBeVisible();
  await demo.page.keyboard.press("Tab");
  await expect(demo.page.locator(".sg-snippet")).toHaveCount(0);
  expect(await demo.text()).toMatch(/^Dated \d{4}-\d{2}-\d{2}$/);
});

test("a snippet limited to the start of a line is offered only there", async ({
  demo,
}) => {
  await demo.open("basics");
  await demo.setText("a ");
  await demo.page.keyboard.type("todo");
  await expect(demo.page.locator(".sg-snippet")).toHaveCount(0);
  await demo.page.keyboard.press("Enter");
  await demo.page.keyboard.type("todo");
  await expect(demo.page.locator(".sg-snippet")).toBeVisible();
  await demo.page.keyboard.press("Tab");
  await demo.page.keyboard.type("x");
  expect(await demo.text()).toBe("a todo\n- [ ] x");
});

test("Escape turns a snippet down", async ({ demo }) => {
  await demo.open("basics");
  await demo.setText("");
  await demo.page.keyboard.type(";date");
  await expect(demo.page.locator(".sg-snippet")).toBeVisible();
  await demo.page.keyboard.press("Escape");
  await expect(demo.page.locator(".sg-snippet")).toHaveCount(0);
  await demo.page.keyboard.press("Tab");
  expect(await demo.text()).toBe(";date\t");
});

test("clicking a task's box ticks it", async ({ demo }) => {
  await demo.open("basics");
  await demo.setText("para\n\n- [ ] task\n", 0);
  await demo.page.locator(".sg-task").click();
  expect(await demo.text()).toBe("para\n\n- [x] task\n");
  await demo.page.locator(".sg-task").click();
  expect(await demo.text()).toBe("para\n\n- [ ] task\n");
});
