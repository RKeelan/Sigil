import { afterEach, describe, expect, test } from "bun:test";
import { type Block, blockKey } from "./changes/model.ts";
import { applyChange, shownChanges } from "./changes/view.ts";
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

  test("leaves out lines of syntax until the cursor is in their construct", () => {
    const sigil = open("intro\n\nTitle\n===\n\n```\ncode\n```\n\nend");
    expect(drawn(sigil)).toEqual(["intro", "", "Title", "", "code", "", "end"]);
    sigil.view.dispatch({ selection: { anchor: 9 } });
    expect(drawn(sigil)).toEqual([
      "intro",
      "",
      "Title",
      "===",
      "",
      "code",
      "",
      "end",
    ]);
    sigil.view.dispatch({ selection: { anchor: 25 } });
    expect(drawn(sigil)).toEqual([
      "intro",
      "",
      "Title",
      "",
      "```",
      "code",
      "```",
      "",
      "end",
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

  test("keeps the shown lines through an edit while a mouse button is down", () => {
    const sigil = open("*a*\n\n*b*");
    mousedown(sigil.view.contentDOM.querySelector(".cm-line"));
    sigil.view.dispatch({ changes: { from: 0, insert: "x" } });
    expect(drawn(sigil)).toEqual(["x*a*", "", "b"]);
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

describe("live preview, revealing constructs", () => {
  /** What the editor draws with the cursor at the `¦` in a text. */
  function at(marked: string): string[] {
    editor?.destroy();
    const anchor = marked.indexOf("¦");
    const sigil = open(marked.replace("¦", ""), {
      settings: { reveal: "construct" },
    });
    sigil.view.dispatch({ selection: { anchor } });
    return drawn(sigil);
  }

  test("shows the syntax of the span the cursor is in, and no other", () => {
    expect(at(`so¦me **bold** and [link](u) here`)).toEqual([
      "some bold and link here",
    ]);
    expect(at(`some **bo¦ld** and [link](u) here`)).toEqual([
      "some **bold** and link here",
    ]);
    expect(at(`some **bold** and [li¦nk](u) here`)).toEqual([
      "some bold and [link](u) here",
    ]);
  });

  test("counts a cursor at either end of a span as touching it", () => {
    expect(at("a ¦*b* c")).toEqual(["a *b* c"]);
    expect(at("a *b*¦ c")).toEqual(["a *b* c"]);
    expect(at("a *b* ¦c")).toEqual(["a b c"]);
    expect(at("*a*¦**b**")).toEqual(["*a***b**"]);
  });

  test("shows every span around the cursor, but not those beside it", () => {
    expect(at("**a *b* c¦**")).toEqual(["**a b c**"]);
    expect(at("**a *b¦* c**")).toEqual(["**a *b* c**"]);
  });

  test("shows code spans, escapes and addresses", () => {
    expect(at("x `co¦de` y")).toEqual(["x `code` y"]);
    expect(at("x `code` ¦y")).toEqual(["x code y"]);
    expect(at("x \\¦* y")).toEqual(["x \\* y"]);
    expect(at("x \\* ¦y")).toEqual(["x * y"]);
    expect(at("<http://a.b¦>")).toEqual(["<http://a.b>"]);
  });

  test("shows a heading's marks from anywhere in the heading", () => {
    expect(at("# Ti¦tle *x*\n\ntext")).toEqual(["# Title x", "", "text"]);
    expect(at("# Title\n\nte¦xt")).toEqual(["Title", "", "text"]);
  });

  test("shows a list marker, task box or quote mark only where the cursor touches it", () => {
    expect(at("- it¦em\n- next")).toEqual(["– item", "– next"]);
    expect(at("- ¦item\n- next")).toEqual(["- item", "– next"]);
    // A task's bullet and its box are drawn with no text of their own.
    expect(at("- [ ] ta¦sk")[0]?.trim()).toBe("task");
    expect(at("- [ ]¦ task")[0]?.trim()).toBe("[ ] task");
    const quoteShown = (marked: string) => {
      at(marked);
      const mark = editor?.view.contentDOM.querySelector(".sg-quote");
      return mark?.classList.contains("sg-syntax");
    };
    expect(quoteShown("> quo¦te")).toBe(false);
    expect(quoteShown(">¦ quote")).toBe(true);
  });

  test("shows a table or fenced block as a whole", () => {
    expect(at("```\nco¦de\n```")).toEqual(["```", "code", "```"]);
    expect(at("| a | b |\n|---|---|\n| 1¦ | 2 |")).toEqual([
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
    ]);
  });

  test("changes from revealing lines while the editor is open", () => {
    const sigil = open("some *text* here");
    sigil.view.dispatch({ selection: { anchor: 1 } });
    expect(drawn(sigil)).toEqual(["some *text* here"]);
    sigil.setSettings({ reveal: "construct" });
    expect(drawn(sigil)).toEqual(["some text here"]);
    sigil.setSettings({ reveal: "line" });
    expect(drawn(sigil)).toEqual(["some *text* here"]);
  });

  test("keeps what it shows as it is while a mouse button is down", () => {
    const sigil = open("*a* *b*", { settings: { reveal: "construct" } });
    sigil.view.dispatch({ selection: { anchor: 1 } });
    mousedown(sigil.view.contentDOM.querySelector(".cm-line"));
    sigil.view.dispatch({ selection: { anchor: 5 } });
    expect(drawn(sigil)).toEqual(["*a* b"]);
    sigil.view.dispatch({ changes: { from: 0, insert: "x" } });
    expect(drawn(sigil)).toEqual(["x*a* b"]);
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    expect(drawn(sigil)).toEqual(["xa *b*"]);
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

  test("skip the lines of syntax that are left out", () => {
    const sigil = open("Title\n===\n\n```\ncode\n```\nend");
    sigil.view.dispatch({ selection: { anchor: sigil.view.state.doc.length } });
    expect(numbers(sigil).slice(1)).toEqual(["1", "3", "5", "7"]);
    sigil.view.dispatch({ selection: { anchor: 20 } });
    expect(numbers(sigil).slice(1)).toEqual(["1", "3", "4", "5", "6", "7"]);
  });

  test("widen for a longer number and never narrow", () => {
    const sigil = open("a");
    sigil.setText(`${"x\n".repeat(999)}x`);
    expect(numbers(sigil)[0]).toBe("0000");
    sigil.setText("a");
    expect(numbers(sigil)[0]).toBe("0000");
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
  const index = "one\ntwo words here to keep\nmiddle\nthree\nfour\n";
  const text = "one\ntwo more words here to keep\nmiddle\nfour\nfive\n";

  function review(host: Host = {}): Sigil {
    const sigil = open(text, { host });
    sigil.setChanges({ index });
    return sigil;
  }

  const count = (sigil: Sigil, selector: string) =>
    sigil.view.dom.querySelectorAll(selector).length;

  test("draws lines taken out where they were, numbered from the index", () => {
    const sigil = review();
    const removed = sigil.view.contentDOM.querySelector(".sg-removed");
    expect(removed?.querySelector(".sg-removed-number")?.textContent).toBe("4");
    expect(removed?.querySelector(".sg-line")?.textContent).toBe("three");
  });

  test("marks an edit within a line, and lines put in", () => {
    const sigil = review();
    const content = sigil.view.contentDOM;
    expect(content.querySelector(".sg-inserted")?.textContent).toBe("more ");
    expect(content.querySelector(".sg-added")?.textContent).toBe("five");
    expect(content.querySelectorAll(".sg-edited").length).toBe(1);
    expect(count(sigil, ".sg-numbers .sg-gutter-added")).toBe(2);
    expect(count(sigil, ".sg-numbers .sg-gutter-removed")).toBe(1);
  });

  test("marks an edit within a line that has lines put in beside it", () => {
    const sigil = open("a\naway for four years\n\nnew line\nb");
    sigil.setChanges({ index: "a\naway for three years\nb" });
    const content = sigil.view.contentDOM;
    expect(content.querySelector(".sg-deleted")?.textContent).toBe("three");
    expect(content.querySelector(".sg-inserted")?.textContent).toBe("four");
    expect(count(sigil, ".sg-edited")).toBe(1);
    expect(count(sigil, ".sg-added")).toBe(2);
    expect(count(sigil, ".sg-removed")).toBe(0);
    expect(count(sigil, ".sg-actions .sg-action")).toBe(1);
  });

  test("gives a change one button, on the removed lines above its edited line", () => {
    const sigil = open("a\nthe slow brown fox\nb");
    sigil.setChanges({ index: "a\ngone entirely\nthe quick brown fox\nb" });
    const removed = sigil.view.contentDOM.querySelector(".sg-removed");
    expect(removed?.textContent).toBe("2gone entirely");
    expect(count(sigil, ".sg-edited")).toBe(1);
    expect(count(sigil, ".sg-actions .sg-action")).toBe(1);
  });

  test("works out again only the changes an edit or a staging touches", () => {
    const sigil = open("A\n\nb\n\nC\n\nD");
    sigil.setChanges({ index: "a\n\nb\n\nc\n\nd" });
    const before = shownChanges(sigil.view.state);
    expect(before.length).toBe(3);
    const line = sigil.view.state.doc.line(5);
    sigil.view.dispatch({ changes: { from: line.from, insert: "C" } });
    const typed = shownChanges(sigil.view.state);
    expect(typed[0]).toBe(before[0] as Block);
    expect(typed[2]).toBe(before[2] as Block);
    expect(sigil.view.state.doc.line(5).text).toBe("CC");
    applyChange(sigil.view, blockKey(typed[1] as Block));
    const staged = shownChanges(sigil.view.state);
    expect(staged).toEqual([typed[0] as Block, typed[2] as Block]);
    expect(staged[0]).toBe(typed[0] as Block);
  });

  test("draws an edit to a table row as the old row above the new", () => {
    const table = "| a | b |\n|---|---|\n| 1 | 2 |";
    const sigil = open(`intro\n\n${table}`);
    sigil.setChanges({ index: `intro\n\n${table.replace("2", "9")}` });
    const removed = sigil.view.contentDOM.querySelector(".sg-removed");
    expect(removed?.querySelector(".sg-row")?.textContent).toBe("19");
    expect(count(sigil, ".sg-inserted")).toBe(0);
  });

  test("gives each change a button that stages it", () => {
    const indexes: string[] = [];
    const sigil = review({ setIndex: (value) => indexes.push(value) });
    const labels = () =>
      [...sigil.view.dom.querySelectorAll(".sg-actions .sg-action")].map(
        (button) => button.textContent,
      );
    expect(labels()).toEqual(["Stage", "Stage", "Stage"]);
    mousedown(sigil.view.dom.querySelector(".sg-action"));
    expect(indexes).toEqual([
      "one\ntwo more words here to keep\nmiddle\nthree\nfour\n",
    ]);
    expect(labels()).toEqual(["Stage", "Stage"]);
  });

  test("draws a staged change as plain text", () => {
    const sigil = review();
    for (const block of [...shownChanges(sigil.view.state)].reverse())
      applyChange(sigil.view, blockKey(block));
    expect(shownChanges(sigil.view.state)).toEqual([]);
    for (const selector of [
      ".sg-edited",
      ".sg-inserted",
      ".sg-deleted",
      ".sg-added",
      ".sg-removed",
      ".sg-gutter-added",
      ".sg-gutter-removed",
      ".sg-action",
    ])
      expect(count(sigil, selector)).toBe(0);
    expect(drawn(sigil)).toEqual([
      "one",
      "two more words here to keep",
      "middle",
      "four",
      "five",
      "",
    ]);
  });

  test("puts lines taken from the end below the last line", () => {
    const sigil = open("one");
    sigil.setChanges({ index: "one\ntwo" });
    const removed = sigil.view.contentDOM.querySelector(".sg-removed");
    expect(removed?.textContent).toBe("2two");
    applyChange(sigil.view, "1:2:1:1");
    expect(count(sigil, ".sg-removed")).toBe(0);
  });

  test("keeps a line of syntax in view while a change to it is waiting", () => {
    const source = "```js\nlet x;\n```\n\nend";
    const sigil = open(source);
    sigil.view.dispatch({ selection: { anchor: source.length } });
    expect(drawn(sigil)).toEqual(["js", "let x;", "", "end"]);
    sigil.setChanges({ index: source.replace("\n```\n", "\n~~~\n") });
    // The fence's row is back, marked as changed, with its syntax hidden as usual.
    expect(drawn(sigil)).toEqual(["js", "let x;", "", "", "end"]);
    const fence = sigil.view.contentDOM.querySelector(".cm-line.sg-code-last");
    expect(fence?.classList.contains("sg-added")).toBe(true);
    sigil.setChanges({ index: source });
    expect(drawn(sigil)).toEqual(["js", "let x;", "", "end"]);
  });

  test("keeps the front matter open while a change in it is waiting", () => {
    const source = "---\na: 1\n---\n\nbody";
    const sigil = open(source);
    expect(foldedFrontMatter(sigil.view.state)).not.toBeNull();
    sigil.setChanges({ index: source.replace("1", "2") });
    expect(foldedFrontMatter(sigil.view.state)).toBeNull();
    sigil.setChanges({ index: source });
    expect(foldedFrontMatter(sigil.view.state)).not.toBeNull();
  });
});
