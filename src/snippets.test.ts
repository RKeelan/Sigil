import { afterEach, describe, expect, test } from "bun:test";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { expand, type Snippet, snippetAt, snippets } from "./snippets.ts";
import { stateOf } from "./testing.ts";

const list: Snippet[] = [
  { trigger: ";date", text: "{{date}}" },
  { trigger: "todo", text: "- [ ] {{cursor}} (due {{date}})", lineStart: true },
  { trigger: "sig", text: "Regards" },
  { trigger: ";;sig", text: "Yours" },
];
const now = () => new Date(2026, 0, 5, 12);

describe("snippetAt", () => {
  const at = (text: string) => snippetAt(stateOf(text), list)?.snippet.trigger;

  test("finds the trigger that ends at the cursor", () => {
    expect(at("on ;date¦")).toBe(";date");
    expect(at("on ;date ¦")).toBeUndefined();
    expect(at("on ;da¦")).toBeUndefined();
  });

  test("takes the longest trigger", () => {
    expect(at("so ;;sig¦")).toBe(";;sig");
    expect(at("so sig¦")).toBe("sig");
  });

  test("doesn't find a trigger in the middle of a word", () => {
    expect(at("design sig¦")).toBe("sig");
    expect(at("desig¦")).toBeUndefined();
  });

  test("keeps a trigger limited to the start of a line there", () => {
    expect(at("todo¦")).toBe("todo");
    expect(at("  todo¦")).toBe("todo");
    expect(at("a todo¦")).toBeUndefined();
  });

  test("finds nothing for a selection", () => {
    expect(at("«;date»")).toBeUndefined();
    expect(at(";date¦ and ;date¦")).toBeUndefined();
  });

  test("gives the extent of the trigger", () => {
    expect(snippetAt(stateOf("on ;date¦"), list)).toMatchObject({
      from: 3,
      to: 8,
    });
  });
});

describe("expand", () => {
  test("fills in the date and finds the cursor", () => {
    expect(expand(list[1] as Snippet, now())).toEqual({
      text: "- [ ]  (due 2026-01-05)",
      cursor: 6,
    });
  });

  test("puts the cursor at the end when the snippet doesn't say", () => {
    expect(expand(list[0] as Snippet, now())).toEqual({
      text: "2026-01-05",
      cursor: 10,
    });
  });
});

describe("in the editor", () => {
  let view: EditorView | null = null;

  afterEach(() => {
    view?.destroy();
    view = null;
  });

  function open(text: string): EditorView {
    const state = stateOf(text, snippets({ snippets: list, now }));
    view = new EditorView({ state, parent: document.body });
    return view;
  }

  function type(editor: EditorView, text: string) {
    for (const ch of text) {
      const { head } = editor.state.selection.main;
      editor.dispatch({
        changes: { from: head, insert: ch },
        selection: { anchor: head + 1 },
        userEvent: "input.type",
      });
    }
  }

  function press(editor: EditorView, key: string): boolean {
    return runScopeHandlers(
      editor,
      new KeyboardEvent("keydown", { key }),
      "editor",
    );
  }

  test("a snippet is offered when its trigger is typed, and taken with Tab", () => {
    const editor = open("on ¦");
    expect(press(editor, "Tab")).toBe(false);
    type(editor, ";date");
    expect(press(editor, "Tab")).toBe(true);
    expect(editor.state.doc.toString()).toBe("on 2026-01-05");
    expect(editor.state.selection.main.head).toBe(13);
    expect(press(editor, "Tab")).toBe(false);
  });

  test("the cursor goes where the snippet says", () => {
    const editor = open("¦");
    type(editor, "todo");
    press(editor, "Tab");
    expect(editor.state.doc.toString()).toBe("- [ ]  (due 2026-01-05)");
    expect(editor.state.selection.main.head).toBe(6);
  });

  test("Escape turns the offer down", () => {
    const editor = open("¦");
    expect(press(editor, "Escape")).toBe(false);
    type(editor, ";date");
    expect(press(editor, "Escape")).toBe(true);
    expect(press(editor, "Tab")).toBe(false);
    expect(editor.state.doc.toString()).toBe(";date");
  });

  test("the offer goes when the cursor moves", () => {
    const editor = open("¦");
    type(editor, ";date");
    editor.dispatch({ selection: { anchor: 0 } });
    expect(press(editor, "Tab")).toBe(false);
  });

  test("the offer shows the text and the key that takes it", () => {
    const editor = open("¦");
    type(editor, ";date");
    const offer = editor.dom.ownerDocument.querySelector(".sg-snippet");
    expect(offer?.querySelector(".sg-snippet-text")?.textContent).toBe(
      "2026-01-05",
    );
    expect(offer?.querySelector(".sg-snippet-key")?.textContent).toBe("Tab");
    offer?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(editor.state.doc.toString()).toBe("2026-01-05");
  });
});
