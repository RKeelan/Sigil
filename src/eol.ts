import { Text } from "@codemirror/state";

/** A text split into lines, with the line ending it is written with. */
export interface Lines {
  text: Text;
  eol: string;
}

/**
 * Splits a string into lines. The editor counts every line break as one character, so the line
 * ending is kept to one side and put back when the text is read out. A text that mixes line
 * endings comes back with the commoner of them throughout.
 */
export function splitLines(source: string): Lines {
  const crlf = source.match(/\r\n/g)?.length ?? 0;
  const lf = (source.match(/\n/g)?.length ?? 0) - crlf;
  return {
    text: Text.of(source.split(/\r\n?|\n/)),
    eol: crlf > lf ? "\r\n" : "\n",
  };
}

/** A text as a string with the given line ending. */
export function joinLines(text: Text, eol: string): string {
  return text.sliceString(0, text.length, eol);
}

/**
 * Where a position in the editor's text is in the string with the given line ending, in which
 * each line break before the position takes up `eol.length` characters.
 */
export function offsetIn(text: Text, pos: number, eol: string): number {
  return eol.length === 1
    ? pos
    : pos + (text.lineAt(pos).number - 1) * (eol.length - 1);
}
