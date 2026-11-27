import { type DemoPage, expect, test } from "./demo.ts";

/**
 * Selects from the start of the line holding `from` to the start of the line holding `to`, and
 * returns the colour painted in the selection on the first of those lines, right of its text.
 */
async function selectedColour(demo: DemoPage, from: string, to: string) {
  const doc = await demo.text();
  const point = await demo.page.evaluate(
    ([anchor, head]) => {
      const { view } = window.sigil.editor;
      view.dispatch({ selection: { anchor, head } });
      view.focus();
      const line = view.state.doc.lineAt(anchor);
      const end = view.coordsAtPos(line.to, -1);
      if (!end) throw new Error("The line isn't drawn.");
      const y = (end.top + end.bottom) / 2;
      const rect = [...view.dom.querySelectorAll(".cm-selectionBackground")]
        .map((element) => element.getBoundingClientRect())
        .find((r) => r.top <= y && r.bottom >= y && r.right > end.right + 8);
      if (!rect)
        throw new Error("The line has no selection right of its text.");
      return { x: rect.right - 4, y };
    },
    [doc.indexOf(from), doc.indexOf(to)] as const,
  );
  // Wait for the selection to be drawn before reading the screen.
  await demo.page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(resolve)),
  );
  return demo.colourAt(point.x, point.y);
}

function cssColour(demo: DemoPage, selector: string, property: string) {
  return demo.page
    .locator(selector)
    .first()
    .evaluate(
      (element, name) => getComputedStyle(element).getPropertyValue(name),
      property,
    );
}

test("a selection shows on the lines of a fenced block", async ({ demo }) => {
  await demo.open("basics");
  await demo.setText("Text\n\n```\nshort\nlonger line of code\n```\n\nAfter\n");
  const colour = await selectedColour(demo, "short", "longer");
  const selection = await cssColour(
    demo,
    ".cm-selectionBackground",
    "background-color",
  );
  expect(colour).toBe(selection);
  expect(
    await cssColour(demo, ".sg-backgrounds .sg-bg-code", "background-color"),
  ).not.toBe(selection);
});

test("a selection shows on a changed line", async ({ demo }) => {
  await demo.open("basics");
  const base = "Text\n\nAfter\n";
  await demo.setText("Text\nnew\nmore\n\nAfter\n");
  await demo.page.evaluate(
    (text) => window.sigil.editor.setChanges({ index: text, head: text }),
    base,
  );
  await expect(demo.page.locator(".sg-added-unstaged")).toHaveCount(2);
  const colour = await selectedColour(demo, "new", "more");
  const selection = await cssColour(
    demo,
    ".cm-selectionBackground",
    "background-color",
  );
  expect(colour).toBe(selection);
  expect(
    await cssColour(demo, ".sg-backgrounds .sg-bg-added", "background-color"),
  ).not.toBe(selection);
});
