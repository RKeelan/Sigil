import { afterEach, describe, expect, test } from "bun:test";
import { EditorView } from "@codemirror/view";
import {
  addSpan,
  isProse,
  type Misspelling,
  misspellingsIn,
  spellCheck,
  subtract,
} from "./spell.ts";
import { stateOf } from "./testing.ts";

describe("spans", () => {
  test("subtract leaves the parts that nothing covers", () => {
    const covered = [
      { from: 2, to: 4 },
      { from: 6, to: 8 },
    ];
    expect(subtract({ from: 0, to: 10 }, covered)).toEqual([
      { from: 0, to: 2 },
      { from: 4, to: 6 },
      { from: 8, to: 10 },
    ]);
    expect(subtract({ from: 3, to: 7 }, covered)).toEqual([{ from: 4, to: 6 }]);
    expect(subtract({ from: 2, to: 4 }, covered)).toEqual([]);
    expect(subtract({ from: 0, to: 1 }, [])).toEqual([{ from: 0, to: 1 }]);
  });

  test("addSpan merges a span with the ones it touches", () => {
    const spans = [
      { from: 0, to: 2 },
      { from: 6, to: 8 },
    ];
    expect(addSpan(spans, { from: 3, to: 4 })).toEqual([
      { from: 0, to: 2 },
      { from: 3, to: 4 },
      { from: 6, to: 8 },
    ]);
    expect(addSpan(spans, { from: 2, to: 6 })).toEqual([{ from: 0, to: 8 }]);
    expect(addSpan(spans, { from: 9, to: 10 })).toEqual([
      ...spans,
      { from: 9, to: 10 },
    ]);
    expect(addSpan([], { from: 1, to: 2 })).toEqual([{ from: 1, to: 2 }]);
  });
});

describe("isProse", () => {
  const prose = (text: string, word: string) => {
    const state = stateOf(text);
    const from = text.indexOf(word);
    return isProse(state, from, from + word.length);
  };

  test("takes in paragraphs, headings, lists and emphasis", () => {
    expect(prose("some wrod here", "wrod")).toBe(true);
    expect(prose("# A wrod", "wrod")).toBe(true);
    expect(prose("- a *wrod*", "wrod")).toBe(true);
    expect(prose("[wrod](http://a.b)", "wrod")).toBe(true);
  });

  test("leaves out code, addresses, HTML and front matter", () => {
    expect(prose("some `wrod` here", "wrod")).toBe(false);
    expect(prose("```\nwrod\n```", "wrod")).toBe(false);
    expect(prose("    wrod", "wrod")).toBe(false);
    expect(prose("see http://a.b/wrod", "wrod")).toBe(false);
    expect(prose("[x](http://a.b/wrod)", "wrod")).toBe(false);
    expect(prose("a <wrod> b", "wrod")).toBe(false);
    expect(prose("---\nwrod: 1\n---\n", "wrod")).toBe(false);
    expect(prose("[wrod]: http://a.b", "wrod")).toBe(false);
  });
});

describe("in the editor", () => {
  let view: EditorView | null = null;

  afterEach(() => {
    view?.destroy();
    view = null;
  });

  const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

  /** A checker that calls every "wrod" and "teh" misspelled, and records what it is asked. */
  function checker() {
    const asked: string[] = [];
    const added: string[] = [];
    const check = async (text: string) => {
      asked.push(text);
      const found: Misspelling[] = [];
      for (const match of text.matchAll(/wrod|teh/g))
        if (!added.includes(match[0]))
          found.push({ from: match.index, to: match.index + match[0].length });
      return found;
    };
    return { asked, added, check };
  }

  function open(text: string, config: ReturnType<typeof checker>) {
    const spelling = spellCheck({
      check: config.check,
      addWord: (word) => config.added.push(word),
      delay: 0,
    });
    view = new EditorView({
      state: stateOf(text, spelling.extension),
      parent: document.body,
    });
    return { view, recheck: spelling.recheck };
  }

  const words = (editor: EditorView) =>
    misspellingsIn(editor.state).map(({ from, to }) =>
      editor.state.sliceDoc(from, to),
    );

  test("marks what the host calls misspelled, in prose only", async () => {
    const config = checker();
    const { view: editor } = open("a wrod and `wrod`\n\nteh end", config);
    expect(words(editor)).toEqual([]);
    await tick();
    expect(config.asked).toEqual(["a wrod and `wrod`\n\nteh end"]);
    expect(misspellingsIn(editor.state)).toEqual([
      { from: 2, to: 6 },
      { from: 19, to: 22 },
    ]);
  });

  test("checks again only the lines that an edit touches", async () => {
    const config = checker();
    const { view: editor } = open("a wrod\n\nfine\n\nteh end", config);
    await tick();
    config.asked.length = 0;
    editor.dispatch({ changes: { from: 12, insert: " wrod" } });
    // The marks on other lines stay where their words are.
    expect(words(editor)).toEqual(["wrod", "teh"]);
    await tick();
    expect(config.asked).toEqual(["fine wrod"]);
    expect(words(editor)).toEqual(["wrod", "wrod", "teh"]);
  });

  test("drops the mark from a word that is edited, until it is checked", async () => {
    const config = checker();
    const { view: editor } = open("a wrod here", config);
    await tick();
    editor.dispatch({ changes: { from: 4, to: 5, insert: "" } });
    expect(words(editor)).toEqual([]);
    await tick();
    expect(words(editor)).toEqual([]);
  });

  test("places marks by where the text has moved to while it was being checked", async () => {
    const config = checker();
    const { view: editor } = open("a wrod\n\nteh end", config);
    editor.dispatch({ changes: { from: 0, insert: "new line\n\n" } });
    await tick();
    await tick();
    expect(words(editor)).toEqual(["wrod", "teh"]);
  });

  test("checks everything again when asked", async () => {
    const config = checker();
    const { view: editor, recheck } = open("a wrod here", config);
    await tick();
    config.added.push("wrod");
    recheck(editor);
    await tick();
    expect(config.asked.length).toBe(2);
    expect(words(editor)).toEqual([]);
  });

  test("offers to add a misspelled word that is right-clicked", async () => {
    const config = checker();
    const { view: editor } = open("wrod and wrod and teh", config);
    await tick();
    const click = () =>
      editor.contentDOM.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 0,
          clientY: 0,
        }),
      );
    // With nothing laid out, every point on the page is the start of the document.
    click();
    const item = editor.dom.querySelector(".sg-menu-item") as HTMLElement;
    expect(item.textContent).toBe("Add “wrod” to dictionary");
    // Opening the menu again replaces it, and a click elsewhere or a key closes it.
    click();
    expect(editor.dom.querySelectorAll(".sg-menu").length).toBe(1);
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(editor.dom.querySelector(".sg-menu")).toBeNull();
    click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(editor.dom.querySelector(".sg-menu")).toBeNull();
    click();
    const again = editor.dom.querySelector(".sg-menu-item") as HTMLElement;
    again.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    again.click();
    expect(config.added).toEqual(["wrod"]);
    expect(words(editor)).toEqual(["teh"]);
    expect(editor.dom.querySelector(".sg-menu")).toBeNull();
    // A word that isn't misspelled has no menu.
    click();
    expect(editor.dom.querySelector(".sg-menu")).toBeNull();
  });

  test("closes the menu when the text changes or the editor goes", async () => {
    const config = checker();
    const { view: editor } = open("wrod", config);
    await tick();
    const click = () =>
      editor.contentDOM.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      );
    click();
    expect(editor.dom.querySelector(".sg-menu")).not.toBeNull();
    editor.dispatch({ changes: { from: 4, insert: "!" } });
    expect(editor.dom.querySelector(".sg-menu")).toBeNull();
  });

  test("carries on when the host fails", async () => {
    const spelling = spellCheck({
      check: () => Promise.reject(new Error("no dictionary")),
      delay: 0,
    });
    view = new EditorView({
      state: stateOf("a wrod", spelling.extension),
      parent: document.body,
    });
    await tick();
    expect(misspellingsIn(view.state)).toEqual([]);
  });
});
