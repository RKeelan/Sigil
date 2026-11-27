import { afterEach, describe, expect, test } from "bun:test";
import { blockKey } from "./changes/model.ts";
import { applyChange, shownChanges } from "./changes/view.ts";
import { type Host, type Options, Sigil, type TextChange } from "./editor.ts";

let editor: Sigil | null = null;

function open(text: string, options: Partial<Options> = {}): Sigil {
  editor = new Sigil({ parent: document.body, text, ...options });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = null;
  document.body.innerHTML = "";
});

function type(sigil: Sigil, from: number, insert: string, to = from) {
  sigil.view.dispatch({
    changes: { from, to, insert },
    userEvent: "input.type",
  });
}

describe("text", () => {
  test("comes back as it was given", () => {
    for (const text of ["", "one", "one\ntwo\n", "one\r\ntwo\r\n", "a\n\n\nb"])
      expect(open(text).text).toBe(text);
  });

  test("keeps Windows line endings through an edit", () => {
    const sigil = open("one\r\ntwo\r\n");
    sigil.view.dispatch({ changes: { from: 3, insert: "\nnew" } });
    expect(sigil.text).toBe("one\r\nnew\r\ntwo\r\n");
  });

  test("is replaced by a change from outside, which is not reported", () => {
    const edits: TextChange[][] = [];
    const sigil = open("alpha beta gamma", {
      host: { edit: (changes) => edits.push([...changes]) },
    });
    sigil.view.dispatch({ selection: { anchor: 16 } });
    sigil.setText("alpha BETA gamma");
    expect(sigil.text).toBe("alpha BETA gamma");
    expect(sigil.view.state.selection.main.head).toBe(16);
    expect(edits).toEqual([]);
    sigil.setText("alpha BETA gamma");
    expect(sigil.text).toBe("alpha BETA gamma");
  });

  test("starts with the cursor after any front matter", () => {
    expect(open("# Title").view.state.selection.main.head).toBe(0);
    editor?.destroy();
    const sigil = open("---\na: 1\n---\n\n# Title");
    expect(sigil.view.state.selection.main.head).toBe(13);
  });
});

describe("edits", () => {
  test("are reported as changes to the text before them", () => {
    const edits: TextChange[][] = [];
    const sigil = open("one two", {
      host: { edit: (changes) => edits.push([...changes]) },
    });
    type(sigil, 3, ",");
    type(sigil, 0, "", 2);
    expect(edits).toEqual([
      [{ from: 3, to: 3, insert: "," }],
      [{ from: 0, to: 2, insert: "" }],
    ]);
  });

  test("are reported in the coordinates of the text with its line endings", () => {
    const edits: TextChange[][] = [];
    const sigil = open("one\r\ntwo\r\nthree", {
      host: { edit: (changes) => edits.push([...changes]) },
    });
    // The start of "three" is 8 in the editor and 10 in the text.
    type(sigil, 8, "a\nb");
    expect(edits).toEqual([[{ from: 10, to: 10, insert: "a\r\nb" }]]);
    expect(sigil.text).toBe("one\r\ntwo\r\na\r\nbthree");
  });
});

describe("settings", () => {
  test("default to the system theme, line numbers, a 90-character measure, line reveal and changes", () => {
    expect(open("text").settings).toEqual({
      theme: "system",
      lineNumbers: true,
      measure: 90,
      reveal: "line",
      showChanges: true,
      snippets: [],
    });
  });

  test("the system theme follows the host", () => {
    const sigil = open("text", { hostTheme: "dark" });
    expect(sigil.view.dom.classList.contains("sg-dark")).toBe(true);
    sigil.setHostTheme("light");
    expect(sigil.view.dom.classList.contains("sg-light")).toBe(true);
    sigil.setSettings({ theme: "dark" });
    expect(sigil.view.dom.classList.contains("sg-dark")).toBe(true);
    sigil.setHostTheme(null);
    expect(sigil.view.dom.classList.contains("sg-dark")).toBe(true);
    sigil.setSettings({ theme: "system" });
    expect(sigil.view.dom.classList.contains("sg-light")).toBe(true);
  });

  test("line numbers can be turned off", () => {
    const sigil = open("text");
    expect(sigil.view.dom.querySelector(".sg-numbers")).not.toBeNull();
    sigil.setSettings({ lineNumbers: false });
    expect(sigil.view.dom.querySelector(".sg-numbers")).toBeNull();
    expect(sigil.settings.lineNumbers).toBe(false);
  });

  test("a nonce is put on the editor's styles", () => {
    open("text", { nonce: "abc123" });
    const styles = [...document.querySelectorAll("style")];
    expect(
      styles.some((style) => style.getAttribute("nonce") === "abc123"),
    ).toBe(true);
  });
});

describe("changes", () => {
  const index = "one\n2\nthree\n";
  const text = "one\ntwo\nthree\nfour\n";

  test("are shown once the host supplies the index to compare with", () => {
    const sigil = open(text);
    expect(shownChanges(sigil.view.state)).toEqual([]);
    expect(sigil.view.dom.querySelector(".sg-actions")).toBeNull();
    sigil.setChanges({ index });
    expect(shownChanges(sigil.view.state).length).toBe(2);
    expect(sigil.view.dom.querySelector(".sg-actions")).not.toBeNull();
    sigil.setChanges(null);
    expect(shownChanges(sigil.view.state)).toEqual([]);
    expect(sigil.view.dom.querySelector(".sg-actions")).toBeNull();
  });

  test("staging hands the host the index's new text", () => {
    const indexes: string[] = [];
    const host: Host = { setIndex: (value) => indexes.push(value) };
    const sigil = open(text, { host });
    sigil.setChanges({ index });
    applyChange(sigil.view, "3:3:3:4");
    expect(indexes).toEqual(["one\n2\nthree\nfour\n"]);
    // A staged change is in the index, so it is no longer shown.
    expect(shownChanges(sigil.view.state).map(blockKey)).toEqual(["1:2:1:2"]);
    applyChange(sigil.view, "1:2:1:2");
    expect(indexes[1]).toBe(text);
    expect(shownChanges(sigil.view.state)).toEqual([]);
    applyChange(sigil.view, "no such change");
    expect(indexes.length).toBe(2);
  });

  test("changes the host unstages reappear when it supplies the index again", () => {
    const sigil = open(text);
    sigil.setChanges({ index: text });
    expect(shownChanges(sigil.view.state)).toEqual([]);
    sigil.setChanges({ index });
    expect(shownChanges(sigil.view.state).length).toBe(2);
  });

  test("the index is written with its own line endings", () => {
    const indexes: string[] = [];
    const sigil = open("one\ntwo\n", {
      host: { setIndex: (value) => indexes.push(value) },
    });
    sigil.setChanges({ index: "one\r\n" });
    applyChange(sigil.view, "1:1:1:2");
    expect(indexes).toEqual(["one\r\ntwo\r\n"]);
  });

  test("are hidden when the setting is off", () => {
    const sigil = open(text, { settings: { showChanges: false } });
    sigil.setChanges({ index });
    expect(shownChanges(sigil.view.state)).toEqual([]);
    sigil.setSettings({ showChanges: true });
    expect(shownChanges(sigil.view.state).length).toBe(2);
  });
});

test("focus goes to the editor", () => {
  const sigil = open("text");
  sigil.focus();
  expect(document.activeElement).toBe(sigil.view.contentDOM);
});
