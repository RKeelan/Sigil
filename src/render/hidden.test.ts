import { describe, expect, test } from "bun:test";
import { moveLineUp } from "@codemirror/commands";
import type { EditorState } from "@codemirror/state";
import { EditorSelection, Text } from "@codemirror/state";
import { parseText } from "../markdown/parser.ts";
import { marked, run, stateOf } from "../testing.ts";
import {
  hiddenLines,
  keepLineShown,
  stopOnHidden,
  syntaxLinesIn,
} from "./hidden.ts";
import { livePreview, revealScope } from "./preview.ts";

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

  test("include a fenced quote's fences, in the order they appear", () => {
    expect(syntaxLines(">>>\nquoted\n>>>")).toEqual([">>>", ">>>"]);
    expect(syntaxLines(">>>\n```\nx\n```\n>>>")).toEqual([
      ">>>",
      "```",
      "```",
      ">>>",
    ]);
    expect(syntaxLines("- item\n\n  >>>\n  in\n  >>>")).toEqual([
      "  >>>",
      "  >>>",
    ]);
  });

  test("leave an empty fenced quote's opening fence, and an unclosed quote's", () => {
    expect(syntaxLines(">>>\n>>>")).toEqual([">>>"]);
    expect(syntaxLines(">>>\nopen\n\nstill")).toEqual([]);
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

  test("are a fenced quote's fences, each shown only while the cursor is on it", () => {
    const quote = "intro\n\n>>>\nfirst\n\nlast\n>>>\n\nend";
    expect(hidden(`¦${quote}`)).toEqual([3, 7]);
    expect(hidden(quote.replace("first", "fi¦rst"))).toEqual([3, 7]);
    expect(hidden(quote.replace(">>>\nfirst", ">>>¦\nfirst"))).toEqual([7]);
    expect(hidden(quote.replace("last\n>>>", "last\n¦>>>"))).toEqual([3]);
  });

  test("show a fenced quote's fence in construct scope while the cursor is at its edge", () => {
    const quote = "intro\n\n>>>\nquoted\n>>>\n\nend";
    const state = stateOf(quote.replace("quoted\n>>>", "quoted\n>>>¦"), [
      livePreview(),
      revealScope.of("construct"),
    ]);
    expect(hidden("", state)).toEqual([3]);
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

  test("moves onto a fence after its indentation, so that it shows in construct scope", () => {
    const text = "- item¦\n  ```\n  code\n  ```\n\nend";
    const state = stateOf(text, [livePreview(), revealScope.of("construct")]);
    expect(hidden("", state)).toEqual([2, 4]);
    const tr = state.update({
      changes: { from: 6, to: 7 },
      userEvent: "delete.forward",
    });
    expect(marked(tr.state)).toBe("- item\n  ¦```\n  code\n  ```\n\nend");
    expect(hidden("", tr.state)).toEqual([]);
  });
});

describe("moving up and down past a hidden line", () => {
  const code = "intro\n\n```\nlet x;\n```\n\nend";

  /**
   * Where Up or Down stops in marked text, when CodeMirror's own move would go to `to`, with a
   * goal column of 30.
   */
  function stop(
    text: string,
    to: number,
    forward: boolean,
    extend = false,
  ): string | null {
    const state = stateOf(text, livePreview());
    const range = state.selection.main;
    const moved = EditorSelection.cursor(to, 0, undefined, 30);
    const stopped = stopOnHidden(state, range, moved, forward, extend);
    if (!stopped) return null;
    expect(stopped.goalColumn).toBe(30);
    return marked(state.update({ selection: stopped }).state);
  }

  test("stops on the end of a closing fence coming up from below", () => {
    const at = code.indexOf("let");
    expect(stop(code.replace("\n\nend", "\n¦\nend"), at, false)).toBe(
      "intro\n\n```\nlet x;\n```¦\n\nend",
    );
  });

  test("stops on the start of an opening fence coming down from above", () => {
    const at = code.indexOf("let");
    expect(stop(code.replace("\n\n```", "\n¦\n```"), at, true)).toBe(
      "intro\n\n¦```\nlet x;\n```\n\nend",
    );
  });

  test("stops on a setext heading's underline coming up from below", () => {
    expect(stop("Title\n=====\n¦end", 2, false)).toBe("Title\n=====¦\nend");
  });

  test("stops on a fenced quote's fences", () => {
    const quote = "intro\n>>>\nquoted\n>>>\nend";
    const at = quote.indexOf("quoted");
    expect(stop(quote.replace("end", "¦end"), at, false)).toBe(
      "intro\n>>>\nquoted\n>>>¦\nend",
    );
    expect(stop(quote.replace("intro", "¦intro"), at, true)).toBe(
      "intro\n¦>>>\nquoted\n>>>\nend",
    );
  });

  test("extends a selection onto the line", () => {
    const at = code.indexOf("let");
    expect(stop(code.replace("end", "end¦"), at, false, true)).toBe(
      "intro\n\n```\nlet x;\n```«\n\nend»",
    );
  });

  test("doesn't stop where the move passes no hidden line", () => {
    expect(stop(`¦${code}`, 6, true)).toBeNull();
    expect(stop(code.replace("let", "l¦et"), 3, false)).toBeNull();
  });
});
