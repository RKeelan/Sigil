import { afterEach, describe, expect, test } from "bun:test";
import { applyChange } from "./changes/view.ts";
import { type Host, type Options, Sigil } from "./editor.ts";
import { foldedFrontMatter } from "./frontmatter.ts";
import { measureIn, remeasure } from "./render/measure.ts";

// These tests look at what the editor draws. The DOM they run against lays nothing out, so they
// check structure and leave sizes and positions to the end-to-end tests.

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

/** The text of each line the editor has drawn. */
function drawn(sigil: Sigil): string[] {
  return [...sigil.view.contentDOM.querySelectorAll(".cm-line")].map(
    (line) => line.textContent ?? "",
  );
}

function mousedown(element: Element | null | undefined) {
  if (!element) throw new Error("There is nothing to click.");
  element.dispatchEvent(
    new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }),
  );
}

describe("live preview", () => {
  test("shows the syntax of the cursor's line only", () => {
    const sigil = open("# Title\n\nsome *text*\n\n- item");
    expect(drawn(sigil)).toEqual(["# Title", "", "some text", "", "– item"]);
    sigil.view.dispatch({ selection: { anchor: 12 } });
    expect(drawn(sigil)).toEqual(["Title", "", "some *text*", "", "– item"]);
    sigil.view.dispatch({ selection: { anchor: 25 } });
    expect(drawn(sigil)).toEqual(["Title", "", "some text", "", "- item"]);
  });

  test("shows the lines a selection touches", () => {
    const sigil = open("*a*\n*b*\n*c*");
    sigil.view.dispatch({ selection: { anchor: 5, head: 9 } });
    expect(drawn(sigil)).toEqual(["a", "*b*", "*c*"]);
  });

  test("draws a table a row per line, and shows its source as a whole", () => {
    const sigil = open("intro\n\n| a | b |\n|---|---|\n| 1 | 2 |");
    const rows = sigil.view.contentDOM.querySelectorAll(".sg-row");
    expect(rows.length).toBe(3);
    expect(rows[1]?.classList.contains("sg-row-delimiter")).toBe(true);
    mousedown(rows[2]?.querySelectorAll(".sg-cell")[1]);
    expect(sigil.view.state.selection.main.head).toBe(33);
    expect(sigil.view.contentDOM.querySelectorAll(".sg-row").length).toBe(0);
    expect(drawn(sigil).slice(2)).toEqual([
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
    ]);
  });

  test("ticks a task when its box is clicked", () => {
    const sigil = open("intro\n\n- [ ] task");
    mousedown(sigil.view.contentDOM.querySelector(".sg-task"));
    expect(sigil.text).toBe("intro\n\n- [x] task");
    mousedown(sigil.view.contentDOM.querySelector(".sg-task"));
    expect(sigil.text).toBe("intro\n\n- [ ] task");
  });

  test("keeps the shown lines as they are while a mouse button is down", () => {
    const sigil = open("*a*\n\n*b*");
    mousedown(sigil.view.contentDOM.querySelector(".cm-line"));
    sigil.view.dispatch({ selection: { anchor: 6 } });
    expect(drawn(sigil)).toEqual(["*a*", "", "b"]);
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    expect(drawn(sigil)).toEqual(["a", "", "*b*"]);
  });

  test("draws a picture in place of its source", () => {
    const sigil = open("intro\n\n![alt](pic.png)");
    const image = sigil.view.contentDOM.querySelector("img.sg-image");
    expect(image?.getAttribute("src")).toBe("pic.png");
    image?.dispatchEvent(new Event("load"));
    image?.dispatchEvent(new Event("error"));
  });

  test("measures text, and notices when the font changes", () => {
    const sigil = open("text");
    const measure = measureIn(sigil.view);
    const plain = { bold: false, italic: false, code: false };
    expect(measure("abcd", plain)).toBeGreaterThan(0);
    expect(measure("abcd", plain)).toBe(measure("abcd", plain));
    // The editor had no font until it was put on the page.
    remeasure(sigil.view);
    expect(remeasure(sigil.view)).toBe(false);
    sigil.view.scrollDOM.style.fontSize = "30px";
    expect(remeasure(sigil.view)).toBe(true);
    expect(remeasure(sigil.view, true)).toBe(true);
  });
});

describe("line numbers", () => {
  const numbers = (sigil: Sigil) =>
    [...sigil.view.dom.querySelectorAll(".sg-numbers .sg-number")].map(
      (number) => number.textContent,
    );

  test("number source lines, after a spacer three digits wide", () => {
    expect(numbers(open("a\nb\nc"))).toEqual(["000", "1", "2", "3"]);
  });

  test("widen for a longer number and never narrow", () => {
    const sigil = open("a");
    sigil.setText(`${"x\n".repeat(999)}x`);
    expect(numbers(sigil)[0]).toBe("0000");
    sigil.setText("a");
    expect(numbers(sigil)[0]).toBe("0000");
  });

  test("carry a heading's size, so as to sit on its baseline", () => {
    const sigil = open("text\n\n## Heading\n\nSetext\n===\n\n> # Quoted");
    const classes = [
      ...sigil.view.dom.querySelectorAll(".sg-numbers .sg-number"),
    ].map((number) => number.className);
    expect(classes.slice(1)).toEqual([
      "sg-number",
      "sg-number",
      "sg-number sg-number-h2",
      "sg-number",
      "sg-number sg-number-h1",
      "sg-number",
      "sg-number",
      "sg-number sg-number-h1",
    ]);
  });
});

describe("front matter", () => {
  const text = "---\ntitle: x\n---\n\nbody";

  test("is folded behind a row that names its lines", () => {
    const sigil = open(text);
    expect(foldedFrontMatter(sigil.view.state)).toEqual({ from: 0, to: 16 });
    const fold = sigil.view.contentDOM.querySelector(".sg-fold");
    expect(fold?.textContent).toBe("front matter, lines 1–3");
    expect(drawn(sigil)[0]).toBe("front matter, lines 1–3");
  });

  test("opens when its fold is clicked, and folds again from its button", () => {
    const sigil = open(text);
    mousedown(sigil.view.contentDOM.querySelector(".sg-fold"));
    expect(foldedFrontMatter(sigil.view.state)).toBeNull();
    expect(drawn(sigil).slice(0, 3)).toEqual(["---fold", "title: x", "---"]);
    sigil.view.dispatch({ selection: { anchor: 6 } });
    mousedown(sigil.view.contentDOM.querySelector(".sg-fold-open"));
    expect(foldedFrontMatter(sigil.view.state)).toEqual({ from: 0, to: 16 });
    expect(sigil.view.state.selection.main.head).toBe(17);
  });

  test("opens when it is edited, or the cursor is put in it", () => {
    const edited = open(text);
    edited.view.dispatch({ changes: { from: 4, insert: "sub" } });
    expect(foldedFrontMatter(edited.view.state)).toBeNull();
    edited.destroy();
    const entered = open(text);
    entered.view.dispatch({ selection: { anchor: 6 } });
    expect(foldedFrontMatter(entered.view.state)).toBeNull();
  });

  test("stays folded for edits and cursors elsewhere", () => {
    const sigil = open(text);
    sigil.view.dispatch({
      changes: { from: 18, insert: "more " },
      selection: { anchor: 20 },
    });
    expect(foldedFrontMatter(sigil.view.state)).toEqual({ from: 0, to: 16 });
  });

  test("is not folded where there is none", () => {
    expect(foldedFrontMatter(open("---\nnot closed").view.state)).toBeNull();
  });
});

describe("changes", () => {
  const head = "one\ntwo words here to keep\nthree\nfour\n";
  const index = "one\ntwo words here to keep\nfour\n";
  const text = "one\ntwo more words here to keep\nfour\nfive\n";

  function review(host: Host = {}): Sigil {
    const sigil = open(text, { host });
    sigil.setChanges({ index, head });
    return sigil;
  }

  test("draws lines taken out where they were, numbered from their own text", () => {
    const sigil = review();
    const removed = sigil.view.contentDOM.querySelector(".sg-removed-staged");
    expect(removed?.querySelector(".sg-removed-number")?.textContent).toBe("3");
    expect(removed?.querySelector(".sg-line")?.textContent).toBe("three");
  });

  test("marks an edit within a line, and lines put in", () => {
    const sigil = review();
    const content = sigil.view.contentDOM;
    expect(content.querySelector(".sg-inserted-unstaged")?.textContent).toBe(
      "more ",
    );
    expect(content.querySelector(".sg-added-unstaged")?.textContent).toBe(
      "five",
    );
    expect(content.querySelectorAll(".sg-edited-unstaged").length).toBe(1);
  });

  test("draws an edit to a table row as the old row above the new", () => {
    const table = "| a | b |\n|---|---|\n| 1 | 2 |";
    const sigil = open(`intro\n\n${table}`);
    sigil.setChanges({
      index: `intro\n\n${table.replace("2", "9")}`,
      head: `intro\n\n${table}`,
    });
    const removed = sigil.view.contentDOM.querySelector(".sg-removed-unstaged");
    expect(removed?.querySelector(".sg-row")?.textContent).toBe("19");
    expect(
      sigil.view.contentDOM.querySelectorAll(".sg-inserted-unstaged").length,
    ).toBe(0);
  });

  test("gives each change a button that stages or unstages it", () => {
    const indexes: string[] = [];
    const sigil = review({ setIndex: (value) => indexes.push(value) });
    const labels = () =>
      [...sigil.view.dom.querySelectorAll(".sg-actions .sg-action")].map(
        (button) => button.textContent,
      );
    expect(labels()).toEqual(["Stage", "Unstage", "Stage"]);
    mousedown(sigil.view.dom.querySelector(".sg-action-unstaged"));
    expect(indexes).toEqual(["one\ntwo more words here to keep\nfour\n"]);
    // The staged edit and the staged removal below it are on neighbouring lines, which makes
    // them one change.
    expect(labels()).toEqual(["Unstage", "Stage"]);
    mousedown(sigil.view.dom.querySelector(".sg-action-staged"));
    expect(indexes[1]).toBe(head);
  });

  test("puts lines taken from the end below the last line", () => {
    const sigil = open("one");
    sigil.setChanges({ index: "one\ntwo", head: "one\ntwo" });
    const removed = sigil.view.contentDOM.querySelector(".sg-removed-unstaged");
    expect(removed?.textContent).toBe("2two");
    applyChange(sigil.view, "unstaged:1:2:1:1");
    const content = sigil.view.contentDOM;
    expect(content.querySelector(".sg-removed-unstaged")).toBeNull();
    expect(content.querySelector(".sg-removed-staged")?.textContent).toBe(
      "2two",
    );
  });

  test("keeps the front matter open while a change in it is waiting", () => {
    const source = "---\na: 1\n---\n\nbody";
    const sigil = open(source);
    expect(foldedFrontMatter(sigil.view.state)).not.toBeNull();
    sigil.setChanges({ index: source.replace("1", "2"), head: source });
    expect(foldedFrontMatter(sigil.view.state)).toBeNull();
    sigil.setChanges({ index: source, head: source });
    expect(foldedFrontMatter(sigil.view.state)).not.toBeNull();
  });
});
