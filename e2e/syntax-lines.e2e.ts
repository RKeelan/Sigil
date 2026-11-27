import { type DemoPage, expect, test } from "./demo.ts";

// Lines that hold nothing but syntax, such as a fenced block's closing fence, a setext heading's
// underline and a fenced quote's `>>>` lines, take up no room until the cursor is in the
// construct they belong to.

const code = "intro\n\n```js\nlet x;\nlet y;\n```\n\nend\n";
const heading = "intro\n\nTitle\n=====\n\nend\n";
const quote = "intro\n\n>>>\nquoted\n>>>\n\nend\n";

/** The number of the line the cursor is on. */
function cursorLine(demo: DemoPage): Promise<number> {
  return demo.page.evaluate(() => {
    const { state } = window.sigil.editor.view;
    return state.doc.lineAt(state.selection.main.head).number;
  });
}

/** How far across the page the cursor is. */
function cursorLeft(demo: DemoPage): Promise<number> {
  return demo.page.evaluate(() => {
    const { view } = window.sigil.editor;
    return view.coordsAtPos(view.state.selection.main.head)?.left ?? Number.NaN;
  });
}

/** The line numbers the gutter shows, without its spacer. */
async function numbers(demo: DemoPage): Promise<string[]> {
  const shown = await demo.page
    .locator(".sg-numbers .cm-gutterElement")
    .allTextContents();
  return shown.slice(1).filter((text) => text !== "");
}

/** Where the top of a rendered line is. */
async function top(demo: DemoPage, text: string): Promise<number> {
  return (await demo.line(text).boundingBox())?.y ?? Number.NaN;
}

test("a closing fence takes up no room until the cursor is in its block", async ({
  demo,
}) => {
  await demo.open("basics");
  await demo.setText(code, 0);
  await expect(demo.page.locator(".sg-code-line")).toHaveCount(3);
  const last = await demo.line("let y;").boundingBox();
  const after = await top(demo, "end");
  // Only the blank line comes between the block and the line after it.
  const blank = (last?.height ?? 0) * 1.5;
  expect(after - ((last?.y ?? 0) + (last?.height ?? 0))).toBeLessThan(blank);
  await demo.cursorAfter("let x");
  await expect(demo.page.locator(".sg-code-line")).toHaveCount(4);
  await expect(demo.page.locator(".sg-code-line").last()).toHaveText("```");
  expect(await top(demo, "end")).toBeGreaterThan(after);
});

test("a setext heading's underline takes up no room until the cursor is on the heading", async ({
  demo,
}) => {
  await demo.open("basics");
  await demo.setText(heading, 0);
  await expect(demo.page.locator(".cm-line", { hasText: "=====" })).toHaveCount(
    0,
  );
  const after = await top(demo, "end");
  await demo.cursorAfter("Title");
  await expect(demo.line("=====")).toBeVisible();
  expect(await top(demo, "end")).toBeGreaterThan(after);
});

test("an opening fence that names no language is hidden too", async ({
  demo,
}) => {
  await demo.open("basics");
  await demo.setText("intro\n\n```\nplain\n```\n\nend\n", 0);
  await expect(demo.page.locator(".sg-code-line")).toHaveCount(1);
  await expect(demo.page.locator(".sg-code-line")).toHaveText("plain");
  await demo.cursorAfter("pla");
  await expect(demo.page.locator(".sg-code-line")).toHaveCount(3);
});

test("the gutter skips the numbers of hidden lines, and numbers the rest beside their rows", async ({
  demo,
}) => {
  await demo.open("basics");
  await demo.setText(code, 0);
  await expect
    .poll(() => numbers(demo))
    .toEqual(["1", "2", "3", "4", "5", "7", "8", "9"]);
  const number = await demo.page
    .locator(".sg-numbers .cm-gutterElement", { hasText: /^8$/ })
    .boundingBox();
  expect(Math.abs((number?.y ?? 0) - (await top(demo, "end")))).toBeLessThan(2);
  await demo.cursorAfter("let x");
  await expect
    .poll(() => numbers(demo))
    .toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
});

test("Down and Up move through a block a row at a time", async ({ demo }) => {
  await demo.open("basics");
  await demo.setText(code, 0);
  const down: number[] = [];
  for (let i = 0; i < 7; i++) {
    await demo.page.keyboard.press("ArrowDown");
    down.push(await cursorLine(demo));
  }
  expect(down).toEqual([2, 3, 4, 5, 6, 7, 8]);
  const up: number[] = [];
  for (let i = 0; i < 7; i++) {
    await demo.page.keyboard.press("ArrowUp");
    up.push(await cursorLine(demo));
  }
  // Coming up from below, the cursor stops on the hidden closing fence, which shows it.
  expect(up).toEqual([7, 6, 5, 4, 3, 2, 1]);
});

test("Up from below a block stops on its closing fence and shows it", async ({
  demo,
}) => {
  await demo.open("basics");
  await demo.setText(code, code.indexOf("\n\nend") + 1);
  await expect(demo.page.locator(".sg-code-line")).toHaveCount(3);
  const above = await top(demo, "let y;");
  await demo.page.keyboard.press("ArrowUp");
  expect(await cursorLine(demo)).toBe(6);
  await expect(demo.page.locator(".sg-code-line")).toHaveCount(4);
  await expect(demo.page.locator(".sg-code-line").last()).toHaveText("```");
  expect(await top(demo, "let y;")).toBe(above);
});

test("Up and Down keep their column across a hidden fence", async ({
  demo,
}) => {
  await demo.open("basics");
  const text =
    "intro text\n\n```\nplain text in the block\n```\n\nending text\n";
  // The cursor starts well to the right of where it stops on the fence, which is its start or
  // its end, so the test tells a kept column from one taken from the fence.
  await demo.setText(text, text.indexOf("ending") + 9);
  const below = await cursorLeft(demo);
  for (let i = 0; i < 3; i++) await demo.page.keyboard.press("ArrowUp");
  expect(await cursorLine(demo)).toBe(4);
  expect(Math.abs((await cursorLeft(demo)) - below)).toBeLessThan(12);
  await demo.setText(text, 8);
  const above = await cursorLeft(demo);
  for (let i = 0; i < 3; i++) await demo.page.keyboard.press("ArrowDown");
  expect(await cursorLine(demo)).toBe(4);
  expect(Math.abs((await cursorLeft(demo)) - above)).toBeLessThan(12);
});

test("Shift+Up from below a block extends the selection onto its closing fence", async ({
  demo,
}) => {
  await demo.open("basics");
  const at = code.indexOf("\n\nend") + 1;
  await demo.setText(code, at);
  await demo.page.keyboard.press("Shift+ArrowUp");
  const selection = await demo.page.evaluate(() => {
    const { main } = window.sigil.editor.view.state.selection;
    return [main.anchor, main.head];
  });
  expect(selection).toEqual([at, at - 1]);
});

test("Down and Up move through a block whose fences are both hidden", async ({
  demo,
}) => {
  await demo.open("basics");
  await demo.setText("intro\n\n```\nplain\n```\n\nend\n", 0);
  const down: number[] = [];
  for (let i = 0; i < 6; i++) {
    await demo.page.keyboard.press("ArrowDown");
    down.push(await cursorLine(demo));
  }
  // Going down, the cursor stops on the hidden opening fence, which shows the block's fences.
  expect(down).toEqual([2, 3, 4, 5, 6, 7]);
  const up: number[] = [];
  for (let i = 0; i < 6; i++) {
    await demo.page.keyboard.press("ArrowUp");
    up.push(await cursorLine(demo));
  }
  expect(up).toEqual([6, 5, 4, 3, 2, 1]);
});

test("Down and Up stop on a setext heading's underline", async ({ demo }) => {
  await demo.open("basics");
  await demo.setText(heading, 0);
  const down: number[] = [];
  for (let i = 0; i < 5; i++) {
    await demo.page.keyboard.press("ArrowDown");
    down.push(await cursorLine(demo));
  }
  expect(down).toEqual([2, 3, 4, 5, 6]);
  const up: number[] = [];
  for (let i = 0; i < 5; i++) {
    await demo.page.keyboard.press("ArrowUp");
    up.push(await cursorLine(demo));
  }
  expect(up).toEqual([5, 4, 3, 2, 1]);
});

test("Left from the line below a hidden fence moves onto the fence and shows it", async ({
  demo,
}) => {
  await demo.open("basics");
  await demo.setText(
    "```js\nlet x;\n```\nend\n",
    "```js\nlet x;\n```\n".length,
  );
  await expect(demo.page.locator(".sg-code-line")).toHaveCount(2);
  await demo.page.keyboard.press("ArrowLeft");
  expect(await cursorLine(demo)).toBe(3);
  await expect(demo.page.locator(".sg-code-line")).toHaveCount(3);
  await demo.page.keyboard.press("ArrowRight");
  expect(await cursorLine(demo)).toBe(4);
});

test("Backspace below a hidden fence shows the fence before it edits it", async ({
  demo,
}) => {
  await demo.open("basics");
  const text = "```js\nlet x;\n```\nend\n";
  await demo.setText(text, "```js\nlet x;\n```\n".length);
  await demo.page.keyboard.press("Backspace");
  expect(await demo.text()).toBe(text);
  expect(await cursorLine(demo)).toBe(3);
  await expect(demo.page.locator(".sg-code-line").last()).toHaveText("```");
  await demo.page.keyboard.press("Backspace");
  expect(await demo.text()).toBe("```js\nlet x;\n``\nend\n");
});

test("Backspace on a blank line below a hidden fence removes the blank line", async ({
  demo,
}) => {
  await demo.open("basics");
  await demo.setText(code, code.indexOf("\n\nend") + 1);
  await demo.page.keyboard.press("Backspace");
  expect(await demo.text()).toBe("intro\n\n```js\nlet x;\nlet y;\n```\nend\n");
});

test("a fenced quote's fences take up no room until the cursor is on them", async ({
  demo,
}) => {
  await demo.open("basics");
  await demo.setText(quote, 0);
  const fences = demo.page.locator(".cm-line", { hasText: ">>>" });
  await expect(fences).toHaveCount(0);
  await expect
    .poll(() => numbers(demo))
    .toEqual(["1", "2", "4", "6", "7", "8"]);
  const after = await top(demo, "end");
  const lines: number[] = [];
  const shown: number[] = [];
  for (let i = 0; i < 5; i++) {
    await demo.page.keyboard.press("ArrowDown");
    lines.push(await cursorLine(demo));
    shown.push(await fences.count());
  }
  // Each fence is shown while the cursor is on it, and hidden again once the cursor moves into
  // the quote or out of it.
  expect(lines).toEqual([2, 3, 4, 5, 6]);
  expect(shown).toEqual([0, 1, 0, 1, 0]);
  expect(await top(demo, "end")).toBe(after);
  await demo.cursorAfter("quoted\n>>>");
  await expect(fences).toHaveCount(1);
  expect(await top(demo, "end")).toBeGreaterThan(after);
});

test("Backspace below a hidden quote fence shows the fence before it edits it", async ({
  demo,
}) => {
  await demo.open("basics");
  const text = ">>>\nquoted\n>>>\nend\n";
  await demo.setText(text, ">>>\nquoted\n>>>\n".length);
  await demo.page.keyboard.press("Backspace");
  expect(await demo.text()).toBe(text);
  expect(await cursorLine(demo)).toBe(3);
  await expect(demo.line(">>>")).toBeVisible();
  await demo.page.keyboard.press("Backspace");
  expect(await demo.text()).toBe(">>>\nquoted\n>>\nend\n");
});
