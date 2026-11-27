import { afterEach, expect, test } from "bun:test";
import { EditorView } from "@codemirror/view";
import { markers } from "./backgrounds.ts";

let view: EditorView | undefined;
afterEach(() => view?.destroy());

/** Adds an element with the given class to the content, which reports the given client rects. */
function element(cls: string, rects: Partial<DOMRect>[]): HTMLElement {
  const span = document.createElement("span");
  span.className = cls;
  span.getClientRects = () => rects as unknown as DOMRectList;
  view?.contentDOM.append(span);
  return span;
}

test("draws a rectangle for each row of each coloured element", () => {
  view = new EditorView({ doc: "text", parent: document.body });
  element("sg-code", [
    { left: 10, top: 20, width: 30, height: 15 },
    { left: 0, top: 35, width: 12, height: 15 },
  ]);
  element("sg-plain", [{ left: 0, top: 0, width: 5, height: 5 }]);
  const drawn = markers(view);
  expect(drawn.map((m) => [m.left, m.top, m.width, m.height])).toEqual([
    [10, 20, 30, 15],
    [0, 35, 12, 15],
  ]);
});

test("a change's colour wins over a code block's", () => {
  view = new EditorView({ doc: "text", parent: document.body });
  element("sg-code-line sg-added-unstaged", [
    { left: 0, top: 0, width: 100, height: 20 },
  ]);
  const [marker] = markers(view);
  const dom = marker?.draw();
  expect(dom?.className).toBe("sg-bg sg-bg-added");
});
