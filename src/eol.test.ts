import { expect, test } from "bun:test";
import { joinLines, offsetIn, splitLines } from "./eol.ts";

test("a text is split into lines and its line ending kept", () => {
  const unix = splitLines("a\nb\n");
  expect(unix.eol).toBe("\n");
  expect(unix.text.lines).toBe(3);
  const windows = splitLines("a\r\nb\r\n");
  expect(windows.eol).toBe("\r\n");
  expect(windows.text.toString()).toBe("a\nb\n");
  expect(splitLines("no breaks").eol).toBe("\n");
});

test("a text of mixed line endings takes the commoner", () => {
  expect(splitLines("a\r\nb\r\nc\nd").eol).toBe("\r\n");
  expect(splitLines("a\r\nb\nc\nd").eol).toBe("\n");
});

test("a text is put back together with its line ending", () => {
  for (const source of ["", "a", "a\r\nb", "a\r\n\r\nb\r\n", "a\nb\n"]) {
    const { text, eol } = splitLines(source);
    expect(joinLines(text, eol)).toBe(source);
  }
});

test("a position counts each line break before it at its full length", () => {
  const { text } = splitLines("ab\r\ncd\r\nef");
  expect(offsetIn(text, 0, "\r\n")).toBe(0);
  expect(offsetIn(text, 2, "\r\n")).toBe(2);
  expect(offsetIn(text, 3, "\r\n")).toBe(4);
  expect(offsetIn(text, 8, "\r\n")).toBe(10);
  expect(offsetIn(text, 8, "\n")).toBe(8);
});
