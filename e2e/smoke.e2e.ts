import { expect, test } from "./demo.ts";

const samples = [
  "basics",
  "lists",
  "tables",
  "code",
  "front-matter",
  "long-lines",
  "changes",
  "manuscript",
];

for (const sample of samples) {
  test(`loads ${sample} from disk without errors`, async ({ demo }) => {
    await demo.open(sample);
    await expect(demo.page.locator(".cm-line").first()).toBeVisible();
    expect((await demo.text()).length).toBeGreaterThan(100);
  });
}
