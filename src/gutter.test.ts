import { expect, test } from "bun:test";
import { firstRow } from "./gutter.ts";

/** An element of the given class that reports the given box. */
function box(cls: string, top: number, bottom: number): HTMLElement {
  const element = document.createElement("span");
  element.className = cls;
  element.getBoundingClientRect = () => ({ top, bottom }) as DOMRect;
  return element;
}

function line(...children: HTMLElement[]): HTMLElement {
  const element = document.createElement("div");
  element.append(...children);
  return element;
}

test("a line with nothing drawn on it has no first row", () => {
  expect(firstRow(line())).toBeNull();
  expect(firstRow(line(box("sg-image", 10, 10)))).toBeNull();
});

test("the first row spans what is drawn beside the first box", () => {
  const row = firstRow(
    line(
      box("sg-image", 10, 90),
      box("sg-rule", 45, 55),
      box("sg-image", 100, 180),
    ),
  );
  expect(row).toEqual({ top: 10, bottom: 90 });
});

test("boxes other than images and rules are left to their text", () => {
  expect(firstRow(line(box("sg-other", 0, 50)))).toBeNull();
});
