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
const head = readFileSync(join(samples, "changes.head.md"), "utf8");
const index = readFileSync(join(samples, "changes.index.md"), "utf8");
const text = readFileSync(join(samples, "changes.md"), "utf8");

test("unstaged changes are shown with a Stage button, and staged ones as plain text", async ({
  demo,
}) => {
  await demo.open("changes");
  const stage = demo.page.locator(".sg-action");
  await expect(stage.first()).toHaveText("Stage");
  await expect(stage).toHaveCount(4);
  // An edit within a line is shown in the line: the old word struck out, the new one marked.
  await expect(demo.page.locator(".sg-deleted")).toHaveText("quie");
  // Lines taken out are drawn where they were, numbered as they were in the index.
  const gone = demo.page.locator(".sg-removed", { hasText: "deleted since" });
  await expect(gone.locator(".sg-removed-number")).toHaveText("17");
  // The staged changes, an edited word, an added item and a removed paragraph, aren't marked.
  await expect(demo.line("four years")).not.toHaveClass(/sg-edited|sg-added/);
  await expect(demo.line("candles")).not.toHaveClass(/sg-edited|sg-added/);
  await expect(demo.page.getByText("gulls")).toHaveCount(0);
});

test("staging a change gives the host the index with that change applied", async ({
  demo,
}) => {
  await demo.open("changes");
  expect(await demo.page.evaluate(() => window.sigil.index)).toBe(index);
  await demo.page.locator(".sg-action").first().click();
  const expected = index.replace(
    "The harbour was quiet when the ship came in. Nobody on the quay looked up.",
    "The harbour was silent when the ship came in. Nobody on the quay looked up from their work.",
  );
  expect(await demo.page.evaluate(() => window.sigil.index)).toBe(expected);
  await expect(demo.page.locator(".sg-action")).toHaveCount(3);
  // The staged edit is drawn as plain text.
  await expect(demo.page.locator(".sg-deleted")).toHaveCount(0);
  await expect(demo.line("silent")).not.toHaveClass(/sg-edited/);
  // The document itself is untouched.
  expect(await demo.text()).toBe(text);
});

test("staging every change makes the index the document", async ({ demo }) => {
  await demo.open("changes");
  const stage = demo.page.locator(".sg-action");
  for (let left = await stage.count(); left > 0; left = await stage.count())
    await stage.first().click();
  expect(await demo.page.evaluate(() => window.sigil.index)).toBe(text);
  await expect(demo.page.locator(".sg-removed")).toHaveCount(0);
});

test("the demo's Unstage all puts HEAD back in the index", async ({ demo }) => {
  await demo.open("changes");
  const unstage = demo.page.getByRole("button", { name: "Unstage all" });
  await demo.page.locator(".sg-action").first().click();
  await unstage.click();
  expect(await demo.page.evaluate(() => window.sigil.index)).toBe(head);
  await expect(unstage).toBeDisabled();
  // The changes that were staged are shown again, as changes from the index. Against HEAD, the
  // edited line and the heading added below it are one change of one line into three, in which
  // the edited line is still drawn as an edit to it.
  await expect(demo.line("four years")).toHaveClass(/sg-edited/);
  await expect(
    demo.line("four years").locator(".sg-deleted", { hasText: "three" }),
  ).toHaveCount(1);
  await expect(demo.line("What she bought")).toHaveClass(/sg-added/);
  await expect(
    demo.page.locator(".sg-removed", { hasText: "three years" }),
  ).toHaveCount(0);
  await expect(demo.line("candles")).toHaveClass(/sg-added/);
  await expect(
    demo.page.locator(".sg-removed", { hasText: "gulls" }),
  ).toHaveCount(1);
  await demo.open("basics");
  await expect(unstage).toBeDisabled();
});

test("typing shows up as an unstaged change", async ({ demo }) => {
  await demo.open("basics");
  await expect(demo.page.locator(".sg-action")).toHaveCount(0);
  await demo.setText("a line of some length\n\ntwo\n");
  await demo.cursor(6);
  await demo.page.keyboard.type(" more");
  await expect(demo.page.locator(".sg-inserted")).toHaveText(" more");
  await expect(demo.page.locator(".sg-action")).toHaveCount(1);
  // The space and the word are two steps of undo.
  await demo.page.keyboard.press("Control+z");
  await demo.page.keyboard.press("Control+z");
  await expect(demo.page.locator(".sg-action")).toHaveCount(0);
  // A line that is mostly rewritten is shown as the old line taken out and the new one put in.
  await demo.cursorAfter("two");
  await demo.page.keyboard.type(" hundred and six");
  await expect(demo.page.locator(".sg-removed")).toHaveText("3two");
  await expect(demo.page.locator(".sg-added")).toHaveText(
    "two hundred and six",
  );
});

test("showing changes can be turned off", async ({ demo }) => {
  await demo.open("changes");
  await expect(demo.page.locator(".sg-action").first()).toBeVisible();
  await demo.page.getByRole("checkbox", { name: "Changes" }).uncheck();
  await expect(demo.page.locator(".sg-action")).toHaveCount(0);
  await expect(demo.page.locator(".sg-removed")).toHaveCount(0);
  await expect(demo.page.locator(".sg-actions")).toHaveCount(0);
  await demo.page.getByRole("checkbox", { name: "Changes" }).check();
  await expect(demo.page.locator(".sg-action").first()).toBeVisible();
});

test("a change in folded front matter opens the fold", async ({ demo }) => {
  await demo.open("front-matter");
  await expect(demo.page.locator(".sg-fold")).toHaveText(
    "front matter, lines 1–9",
  );
  const source = await demo.text();
  await demo.page.evaluate(
    (changed) => {
      window.sigil.editor.setChanges({ index: changed });
    },
    source.replace("draft: true", "draft: false"),
  );
  await expect(demo.line("draft: true")).toBeVisible();
  await expect(demo.page.locator(".sg-action")).toHaveCount(1);
});

test("a selection across removed lines doesn't show the browser's own", async ({
  demo,
}) => {
  await demo.open("changes");
  await demo.page.evaluate(() => {
    const { view } = window.sigil.editor;
    const doc = view.state.doc.toString();
    view.dispatch({
      selection: {
        anchor: doc.indexOf("She had"),
        head: doc.indexOf("A paragraph added"),
      },
    });
    view.focus();
  });
  const removed = demo.page.locator(".sg-removed", {
    hasText: "deleted since",
  });
  const shot = await removed.screenshot();
  // The browser paints its selection in a saturated blue that no colour of the palette comes near.
  // Text is antialiased with coloured fringes, so a few blue pixels are allowed, but not a fill.
  const decoder = await demo.page.context().newPage();
  const blue = await decoder.evaluate(
    async (bytes) => {
      const image = await createImageBitmap(
        new Blob([new Uint8Array(bytes)], { type: "image/png" }),
      );
      const canvas = new OffscreenCanvas(image.width, image.height);
      const context = canvas.getContext(
        "2d",
      ) as OffscreenCanvasRenderingContext2D;
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, image.width, image.height);
      let count = 0;
      for (let i = 0; i < data.length; i += 4)
        if ((data[i + 2] as number) - (data[i] as number) > 100) count++;
      return count / (image.width * image.height);
    },
    [...shot],
  );
  await decoder.close();
  expect(blue).toBeLessThan(0.05);
});
