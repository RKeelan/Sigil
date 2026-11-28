import type { InlineContext, MarkdownConfig } from "@lezer/markdown";

const dollar = 36;
const backslash = 92;
const backtick = 96;
const closeBracket = 93;

const letter = /\p{L}/u;

/** Whether the text at `pos` is a `$` followed directly by a letter, which opens a note. */
function opensNote(text: string, pos: number): boolean {
  return (
    text.charCodeAt(pos) === dollar &&
    letter.test(String.fromCodePoint(text.codePointAt(pos + 1) ?? 0))
  );
}

/** The end of the code span whose opening backticks start at `pos`, or -1 if it isn't closed. */
function codeSpanEnd(text: string, pos: number): number {
  let open = pos;
  while (text.charCodeAt(open) === backtick) open++;
  const size = open - pos;
  for (let i = open; i < text.length;) {
    if (text.charCodeAt(i) !== backtick) {
      i++;
      continue;
    }
    let run = i;
    while (text.charCodeAt(run) === backtick) run++;
    if (run - i === size) return run;
    i = run;
  }
  return -1;
}

/**
 * Where the note that opens at `start` ends, as a position in `text`, and whether a `$` closes
 * it. A note runs to the next `$` that isn't followed by a letter, which closes it. It ends
 * without one before a `$` that opens another note, before a `]` that may close a link the note
 * is in, and at the end of the paragraph. A `$` in a code span or escaped by a backslash doesn't
 * close a note.
 */
function noteEnd(
  text: string,
  start: number,
  inLink: boolean,
): { end: number; closed: boolean } {
  for (let i = start + 1; i < text.length;) {
    const ch = text.charCodeAt(i);
    if (ch === backslash) {
      i += 2;
    } else if (ch === backtick) {
      const end = codeSpanEnd(text, i);
      if (end < 0) {
        while (text.charCodeAt(i) === backtick) i++;
      } else {
        i = end;
      }
    } else if (ch === dollar) {
      if (opensNote(text, i)) return { end: i, closed: false };
      return { end: i + 1, closed: true };
    } else if (ch === closeBracket && inLink) {
      return { end: i, closed: false };
    } else {
      i++;
    }
  }
  return { end: text.length, closed: false };
}

function parseNote(cx: InlineContext, next: number, pos: number): number {
  const from = pos - cx.offset;
  if (next !== dollar || !opensNote(cx.text, from)) return -1;
  const { end, closed } = noteEnd(cx.text, from, cx.hasOpenLink);
  const contentEnd = closed ? end - 1 : end;
  const children = [
    cx.elt("NoteMark", pos, pos + 1),
    ...cx.parser.parseInline(cx.text.slice(from + 1, contentEnd), pos + 1),
  ];
  if (closed)
    children.push(cx.elt("NoteMark", cx.offset + contentEnd, cx.offset + end));
  return cx.addElement(cx.elt("Note", pos, cx.offset + end, children));
}

/**
 * Notes: an inline note opened by a `$` followed directly by a letter, such as `$Note check this$`,
 * and closed by the next `$`, or left open to the end of the paragraph. A `$` followed by a digit
 * or a space opens nothing, so prices stay plain text.
 */
export const notes: MarkdownConfig = {
  defineNodes: [{ name: "Note" }, { name: "NoteMark" }],
  parseInline: [{ name: "Note", parse: parseNote }],
};
