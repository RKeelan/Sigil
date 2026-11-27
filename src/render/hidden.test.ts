import { describe, expect, test } from "bun:test";
import { moveLineUp } from "@codemirror/commands";
import type { EditorState } from "@codemirror/state";
import { Text } from "@codemirror/state";
import { parseText } from "../markdown/parser.ts";
import { marked, run, stateOf } from "../testing.ts";
import { hiddenLines, keepLineShown, syntaxLinesIn } from "./hidden.ts";
import { livePreview } from "./preview.ts";

/** The text of each line of syntax in a document. */
function syntaxLines(source: string): string[] {
  const doc = Text.of(source.split("\n"));
  return syntaxLinesIn(doc, parseText(doc)).map((line) =>
    doc.sliceString(line.from, line.to),
  );
}

/** The numbers of the lines hidden in a state built from marked text. */
function hidden(marked: string, state?: EditorState): number[] {
  const built = state ?? stateOf(marked, livePreview());
  return hiddenLines(built).map((line) => built.doc.lineAt(line.from).number);
}

describe("lines of syntax", () => {
  test("are a fenced block's closing fence and a setext heading's underline", () => {
    expect(
      syntaxLines(
        "```js\ncode\n```\n\nTitle\n=====\n\nSub\n---\n\n~~~\nx\n~~~",
      ),
    ).toEqual(["```", "=====", "---", "~~~", "~~~"]);
  });

  test("include an opening fence only when it names no language", () => {
    expect(syntaxLines("```\ncode\n```")).toEqual(["```", "```"]);
    expect(syntaxLines("```py\ncode\n```")).toEqual(["```"]);
  });

  test("leave an empty block's opening fence, so that the block keeps a row", () => {
    expect(syntaxLines("```\n```")).toEqual(["```"]);
  });

  test("are found in quotes and list items", () => {
    expect(syntaxLines("> ```\n> code\n> ```")).toEqual(["> ```", "> ```"]);
    expect(syntaxLines("- item\n\n  ```\n  code\n  ```")).toEqual([
      "  ```",
      "  ```",
    ]);
  });

  test("leave out a fence that shares its line with a list marker", () => {
    expect(syntaxLines("- ```\n  code\n  ```")).toEqual(["  ```"]);
  });

  test("leave out an unclosed block's end, and fences inside code", () => {
    expect(syntaxLines("```js\ncode")).toEqual([]);
    expect(syntaxLines("~~~md\n```js\nx\n```\n~~~")).toEqual(["~~~"]);
  });

  test("leave out the front matter", () => {
    expect(syntaxLines("---\ntitle: x\n---\n\nbody")).toEqual([]);
  });
});

describe("hidden lines", () => {
  const code = "intro\n\n```js\nlet x;\n```\n\nend";
  const heading = "intro\n\nTitle\n=====\n\nend";

  test("are hidden while the cursor is elsewhere", () => {
    expect(hidden(`¦${code}`)).toEqual([5]);
    expect(hidden(code.replace("end", "e¦nd"))).toEqual([5]);
    expect(hidden(`¦${heading}`)).toEqual([4]);
    expect(hidden(heading.replace("end", "¦end"))).toEqual([4]);
  });

  test("are shown while the cursor is anywhere in their construct", () => {
    expect(hidden(code.replace("```js", "¦```js"))).toEqual([]);
    expect(hidden(code.replace("let", "l¦et"))).toEqual([]);
    expect(hidden(code.replace("x;\n```", "x;\n```¦"))).toEqual([]);
    expect(hidden(heading.replace("Title", "Ti¦tle"))).toEqual([]);
    expect(hidden(heading.replace("=====", "==¦==="))).toEqual([]);
  });

  test("are shown while a selection runs over them", () => {
    expect(
      hidden(code.replace("intro", "«intro").replace("end", "end»")),
    ).toEqual([]);
  });

  test("are kept in view while something wants them shown", () => {
    const state = stateOf(`¦${code}`, [
      livePreview(),
      keepLineShown.of((_state, line) => line === 5),
    ]);
    expect(hidden("", state)).toEqual([]);
  });
});

/**
 * Deletes the character before the cursor, or after it, as Backspace and Delete do, and returns
 * the marked text left.
 */
function remove(text: string, direction: "backward" | "forward"): string {
  const state = stateOf(text, livePreview());
  const at = state.selection.main.head;
  const from = direction === "backward" ? at - 1 : at;
  const tr = state.update({
    changes: { from, to: from + 1 },
    selection: { anchor: from },
    userEvent: `delete.${direction}`,
  });
  return marked(tr.state);
}

describe("editing next to a hidden line", () => {
  const text = "```js\nlet x;\n```\n";

  test("moves onto the line rather than join another line to it", () => {
    expect(remove(`${text}¦end`, "backward")).toBe("```js\nlet x;\n```¦\nend");
    expect(remove("intro¦\n```\nx\n```", "forward")).toBe(
      "intro\n¦```\nx\n```",
    );
  });

  test("edits the line once it is shown", () => {
    expect(remove("```js\nlet x;\n```¦\nend", "backward")).toBe(
      "```js\nlet x;\n``¦\nend",
    );
  });

  test("removes a blank line next to it, which leaves it as it is", () => {
    expect(remove(`${text}¦\nend`, "backward")).toBe(
      "```js\nlet x;\n```¦\nend",
    );
    expect(remove("intro\n¦\n```\nx\n```", "forward")).toBe(
      "intro\n¦```\nx\n```",
    );
  });

  test("moves onto the line rather than move another line past it", () => {
    expect(run(moveLineUp, `${text}end¦`, livePreview())).toBe(
      "```js\nlet x;\n```¦\nend",
    );
  });

  test("is left alone where nothing is hidden", () => {
    expect(remove("a\n¦b", "backward")).toBe("a¦b");
  });
});
