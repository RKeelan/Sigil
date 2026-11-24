import { describe, expect, test } from "bun:test";
import { run } from "../testing.ts";
import { continueMarkup, nestItem, outdentItem } from "./lists.ts";

describe("Enter", () => {
  test("continues a bullet with the same marker", () => {
    expect(run(continueMarkup, "- one¦")).toBe("- one\n- ¦");
    expect(run(continueMarkup, "* one¦")).toBe("* one\n* ¦");
    expect(run(continueMarkup, "+ one¦")).toBe("+ one\n+ ¦");
  });

  test("continues a numbered item with the next number", () => {
    expect(run(continueMarkup, "1. one¦")).toBe("1. one\n2. ¦");
    expect(run(continueMarkup, "9) nine¦")).toBe("9) nine\n10) ¦");
  });

  test("never renumbers the items that follow", () => {
    expect(run(continueMarkup, "1. one¦\n2. two\n3. three")).toBe(
      "1. one\n2. ¦\n2. two\n3. three",
    );
  });

  test("continues a task with an open task", () => {
    expect(run(continueMarkup, "- [x] done¦")).toBe("- [x] done\n- [ ] ¦");
  });

  test("keeps the item's indentation and quote marks", () => {
    expect(run(continueMarkup, "- one\n  - two¦")).toBe(
      "- one\n  - two\n  - ¦",
    );
    expect(run(continueMarkup, "> - one¦")).toBe("> - one\n> - ¦");
    expect(run(continueMarkup, "> 1. one\n>    - two¦")).toBe(
      "> 1. one\n>    - two\n>    - ¦",
    );
  });

  test("carries the text after the cursor into the new item", () => {
    expect(run(continueMarkup, "- one ¦two")).toBe("- one \n- ¦two");
    expect(run(continueMarkup, "- one¦ two")).toBe("- one\n- ¦two");
  });

  test("continues from a wrapped line of the item's first paragraph", () => {
    expect(run(continueMarkup, "- one\n  two¦")).toBe("- one\n  two\n- ¦");
  });

  test("leaves a later paragraph of an item to the default", () => {
    expect(run(continueMarkup, "- one\n\n  two¦")).toBeNull();
  });

  test("outdents an empty nested item", () => {
    expect(run(continueMarkup, "- one\n  - ¦")).toBe("- one\n- ¦");
    expect(run(continueMarkup, "1. one\n   - two\n   - ¦")).toBe(
      "1. one\n   - two\n- ¦",
    );
  });

  test("takes the marker off an empty item that isn't nested", () => {
    expect(run(continueMarkup, "- one\n- ¦")).toBe("- one\n¦");
    expect(run(continueMarkup, "- [ ] ¦")).toBe("¦");
    expect(run(continueMarkup, "> - ¦")).toBe("> ¦");
  });

  test("continues a quote", () => {
    expect(run(continueMarkup, "> one¦")).toBe("> one\n> ¦");
    expect(run(continueMarkup, "> > one¦")).toBe("> > one\n> > ¦");
    expect(run(continueMarkup, "- > one¦")).toBe("- > one\n  > ¦");
  });

  test("keeps one empty quoted line and ends the quote on a second", () => {
    expect(run(continueMarkup, "> one\n> ¦")).toBe("> one\n> \n> ¦");
    expect(run(continueMarkup, "> one\n> \n> ¦")).toBe("> one\n\n¦");
  });

  test("declines outside lists and quotes", () => {
    expect(run(continueMarkup, "plain¦")).toBeNull();
    expect(run(continueMarkup, "```\n- code¦\n```")).toBeNull();
    expect(run(continueMarkup, "- «one»")).toBeNull();
    expect(run(continueMarkup, "¦- one")).toBeNull();
  });

  test("handles several cursors at once", () => {
    expect(run(continueMarkup, "- a¦\n\n1. b¦")).toBe("- a\n- ¦\n\n1. b\n2. ¦");
  });
});

describe("Tab", () => {
  test("nests an item under the one above it, at its content column", () => {
    expect(run(nestItem, "- one\n- ¦two")).toBe("- one\n  - ¦two");
    expect(run(nestItem, "1. one\n2. ¦two")).toBe("1. one\n   2. ¦two");
    expect(run(nestItem, "10. one\n11. ¦")).toBe("10. one\n    11. ¦");
    expect(run(nestItem, "- [ ] one\n- [ ] ¦two")).toBe(
      "- [ ] one\n  - [ ] ¦two",
    );
  });

  test("moves the item's other lines and nested items with it", () => {
    expect(run(nestItem, "- one\n- ¦two\n  more\n  - three\n- four")).toBe(
      "- one\n  - ¦two\n    more\n    - three\n- four",
    );
  });

  test("nests inside a quote", () => {
    expect(run(nestItem, "> - one\n> - ¦two")).toBe("> - one\n>   - ¦two");
  });

  test("types a tab anywhere else", () => {
    expect(run(nestItem, "- one\n- tw¦o")).toBe("- one\n- tw\t¦o");
    expect(run(nestItem, "plain¦")).toBe("plain\t¦");
    expect(run(nestItem, "- ¦only")).toBe("- \t¦only");
    expect(run(nestItem, "a «b» c")).toBe("a \t¦ c");
  });

  test("nests every item in a selection across lines, keeping them siblings", () => {
    expect(run(nestItem, "- one\n- «two\n- thr»ee\n- four")).toBe(
      "- one\n  - «two\n  - thr»ee\n- four",
    );
  });

  test("leaves out a line the selection only reaches the start of", () => {
    expect(run(nestItem, "- one\n«- two\n»- three")).toBe(
      "- one\n  «- two\n»- three",
    );
  });
});

describe("Shift+Tab", () => {
  test("moves an item out to where its parent starts", () => {
    expect(run(outdentItem, "- one\n  - tw¦o")).toBe("- one\n- tw¦o");
    expect(run(outdentItem, "1. one\n   - ¦two\n     more")).toBe(
      "1. one\n- ¦two\n  more",
    );
  });

  test("outdents every item in a selection across lines", () => {
    expect(run(outdentItem, "- one\n  - «two\n  - thr»ee")).toBe(
      "- one\n- «two\n- thr»ee",
    );
  });

  test("does nothing to an item that isn't nested, or outside a list", () => {
    expect(run(outdentItem, "- on¦e")).toBe("- on¦e");
    expect(run(outdentItem, "pla¦in")).toBe("pla¦in");
  });
});
