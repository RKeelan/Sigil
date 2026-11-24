import {
  EditorSelection,
  EditorState,
  type Extension,
  type SelectionRange,
  type StateCommand,
} from "@codemirror/state";
import { markdownLanguage } from "./markdown/parser.ts";

/**
 * Builds a state from text in which `¦` marks a cursor and `«` and `»` enclose a selection.
 * The document is the text without the marks.
 */
export function stateOf(
  marked: string,
  extensions: Extension = [],
): EditorState {
  let doc = "";
  let anchor = -1;
  const ranges: SelectionRange[] = [];
  for (const ch of marked) {
    if (ch === "¦") ranges.push(EditorSelection.cursor(doc.length));
    else if (ch === "«") anchor = doc.length;
    else if (ch === "»") ranges.push(EditorSelection.range(anchor, doc.length));
    else doc += ch;
  }
  return EditorState.create({
    doc,
    selection: ranges.length ? EditorSelection.create(ranges) : undefined,
    extensions: [
      markdownLanguage,
      EditorState.allowMultipleSelections.of(true),
      extensions,
    ],
  });
}

/** A state's text with its cursors and selections marked the way `stateOf` reads them. */
export function marked(state: EditorState): string {
  let text = state.doc.toString();
  const ranges = [...state.selection.ranges].sort((a, b) => b.from - a.from);
  for (const range of ranges) {
    text = range.empty
      ? `${text.slice(0, range.from)}¦${text.slice(range.from)}`
      : `${text.slice(0, range.from)}«${text.slice(range.from, range.to)}»${text.slice(range.to)}`;
  }
  return text;
}

/** Runs a command, returning the marked text it leaves, or null if it declined to run. */
export function run(
  command: StateCommand,
  text: string,
  extensions: Extension = [],
): string | null {
  let state = stateOf(text, extensions);
  const handled = command({
    state,
    dispatch: (tr) => {
      state = tr.state;
    },
  });
  return handled ? marked(state) : null;
}
