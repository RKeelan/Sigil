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

test("staged and unstaged changes are both shown, each with its button", async ({
  demo,
}) => {
  await demo.open("changes");
  const stage = demo.page.locator(".sg-action-unstaged");
  const unstage = demo.page.locator(".sg-action-staged");
  await expect(stage.first()).toHaveText("Stage");
  await expect(unstage.first()).toHaveText("Unstage");
  await expect(stage).toHaveCount(4);
  await expect(unstage).toHaveCount(3);
  // An edit within a line is shown in the line: the old word struck out, the new one marked.
  await expect(demo.page.locator(".sg-deleted-unstaged")).toHaveText("quie");
  await expect(demo.page.locator(".sg-deleted-staged")).toHaveText("three");
  await expect(demo.page.locator(".sg-inserted-staged")).toHaveText("four");
  // Lines taken out are drawn where they were, numbered as they were in the text they came from.
  const gone = demo.page.locator(".sg-removed-unstaged", {
    hasText: "deleted since",
  });
  await expect(gone.locator(".sg-removed-number")).toHaveText("17");
});

test("staging a change gives the host the index with that change applied", async ({
  demo,
}) => {
  await demo.open("changes");
  expect(await demo.page.evaluate(() => window.sigil.index)).toBe(index);
  await demo.page.locator(".sg-action-unstaged").first().click();
  const expected = index.replace(
    "The harbour was quiet when the ship came in. Nobody on the quay looked up.",
    "The harbour was silent when the ship came in. Nobody on the quay looked up from their work.",
  );
  expect(await demo.page.evaluate(() => window.sigil.index)).toBe(expected);
  await expect(demo.page.locator(".sg-action-unstaged")).toHaveCount(3);
  await expect(demo.page.locator(".sg-action-staged")).toHaveCount(4);
  // The document itself is untouched.
  expect(await demo.text()).toBe(text);
});

test("staging every change makes the index the document", async ({ demo }) => {
  await demo.open("changes");
  const stage = demo.page.locator(".sg-action-unstaged");
  for (let left = await stage.count(); left > 0; left = await stage.count())
    await stage.first().click();
  expect(await demo.page.evaluate(() => window.sigil.index)).toBe(text);
  await expect(demo.page.locator(".sg-action-staged").first()).toBeVisible();
});

test("unstaging every change makes the index HEAD", async ({ demo }) => {
  await demo.open("changes");
  const unstage = demo.page.locator(".sg-action-staged");
  for (let left = await unstage.count(); left > 0; left = await unstage.count())
    await unstage.first().click();
  expect(await demo.page.evaluate(() => window.sigil.index)).toBe(head);
});

test("typing shows up as an unstaged change", async ({ demo }) => {
  await demo.open("basics");
  await expect(demo.page.locator(".sg-action")).toHaveCount(0);
  await demo.setText("a line of some length\n\ntwo\n");
  await demo.cursor(6);
  await demo.page.keyboard.type(" more");
  await expect(demo.page.locator(".sg-inserted-unstaged")).toHaveText(" more");
  await expect(demo.page.locator(".sg-action-unstaged")).toHaveCount(1);
  // The space and the word are two steps of undo.
  await demo.page.keyboard.press("Control+z");
  await demo.page.keyboard.press("Control+z");
  await expect(demo.page.locator(".sg-action")).toHaveCount(0);
  // A line that is mostly rewritten is shown as the old line taken out and the new one put in.
  await demo.cursorAfter("two");
  await demo.page.keyboard.type(" hundred and six");
  await expect(demo.page.locator(".sg-removed-unstaged")).toHaveText("3two");
  await expect(demo.page.locator(".sg-added-unstaged")).toHaveText(
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
      window.sigil.editor.setChanges({ index: changed, head: changed });
    },
    source.replace("draft: true", "draft: false"),
  );
  await expect(demo.line("draft: true")).toBeVisible();
  await expect(demo.page.locator(".sg-action-unstaged")).toHaveCount(1);
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
  const removed = demo.page.locator(".sg-removed-unstaged", {
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
