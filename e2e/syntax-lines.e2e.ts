import { type DemoPage, expect, test } from "./demo.ts";

// Lines that hold nothing but syntax, a fenced block's closing fence and a setext heading's
// underline, take up no room until the cursor is in the construct they belong to.

const code = "intro\n\n```js\nlet x;\nlet y;\n```\n\nend\n";
const heading = "intro\n\nTitle\n=====\n\nend\n";

/** The number of the line the cursor is on. */
function cursorLine(demo: DemoPage): Promise<number> {
  return demo.page.evaluate(() => {
    const { state } = window.sigil.editor.view;
    return state.doc.lineAt(state.selection.main.head).number;
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
  // Coming up from below, the row above the blank line is the block's last line of code. The
  // fence appears below the cursor, so nothing above it moves.
  expect(up).toEqual([7, 5, 4, 3, 2, 1, 1]);
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
  // Each key goes to the row that was next to the cursor's, which skips the hidden fence on the
  // way in. Once the cursor is in the block, both fences are shown and have rows of their own.
  expect(down).toEqual([2, 4, 5, 6, 7, 8]);
  const up: number[] = [];
  for (let i = 0; i < 6; i++) {
    await demo.page.keyboard.press("ArrowUp");
    up.push(await cursorLine(demo));
  }
  expect(up).toEqual([7, 6, 4, 3, 2, 1]);
});

test("Down and Up move past a setext heading's underline", async ({ demo }) => {
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
  expect(up).toEqual([5, 3, 2, 1, 1]);
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
