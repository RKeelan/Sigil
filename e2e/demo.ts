import { test as base, expect, type Page } from "@playwright/test";
import type {} from "../demo/api.ts";

/** The demo page with one sample loaded, and the things the tests do to it. */
export class DemoPage {
  readonly errors: string[] = [];

  constructor(readonly page: Page) {
    page.on("pageerror", (error) => this.errors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error") this.errors.push(message.text());
    });
  }

  /** Opens the page on a sample document, as a user would. */
  async open(sample: string) {
    await this.page.goto(`/#${sample}`);
    await this.page.locator(".cm-content").waitFor();
  }

  /** The document's text, byte for byte. */
  text(): Promise<string> {
    return this.page.evaluate(() => window.sigil.text);
  }

  /** Replaces the document with the given text and puts the cursor at an offset in it. */
  async setText(text: string, cursor = text.length) {
    await this.page.evaluate(
      ([value, at]) => {
        const { editor } = window.sigil;
        editor.setText(value);
        editor.setChanges({ index: value, head: value });
        editor.view.dispatch({ selection: { anchor: at } });
        editor.view.focus();
      },
      [text, cursor] as const,
    );
  }

  /** Puts the cursor at an offset in the document. */
  async cursor(at: number) {
    await this.page.evaluate((anchor) => {
      const { view } = window.sigil.editor;
      view.dispatch({ selection: { anchor } });
      view.focus();
    }, at);
  }

  /** Puts the cursor at the end of the first occurrence of some text. */
  async cursorAfter(text: string) {
    const doc = await this.text();
    const at = doc.indexOf(text);
    if (at < 0) throw new Error(`The document doesn't contain "${text}".`);
    await this.cursor(at + text.length);
  }

  /** The rendered line that holds some text. */
  line(text: string) {
    return this.page.locator(".cm-line", { hasText: text }).first();
  }

  /** Fails if the page logged an error or broke its content security policy. */
  async expectClean() {
    expect(await this.page.evaluate(() => window.sigil.violations)).toEqual([]);
    expect(this.errors).toEqual([]);
  }
}

export const test = base.extend<{ demo: DemoPage }>({
  demo: async ({ page: tab }, use) => {
    const demo = new DemoPage(tab);
    await use(demo);
    await demo.expectClean();
  },
});

export { expect };
