import {
  defaultKeymap,
  history,
  historyKeymap,
  splitLine,
} from "@codemirror/commands";
import { selectNextOccurrence } from "@codemirror/search";
import type { Extension, Transaction } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { continueMarkup, nestItem, outdentItem } from "./lists.ts";

/**
 * Whether an edit belongs to the undo step before it. Typing joins the step until it starts a
 * new word, so a step is a word and the whitespace after it, however long the typing took.
 */
export function joinsUndoStep(tr: Transaction, adjacent: boolean): boolean {
  if (!adjacent) return false;
  if (!tr.isUserEvent("input.type")) return true;
  let startsWord = false;
  tr.changes.iterChanges((from, _to, _fromB, _toB, inserted) => {
    if (!inserted.length || /^\s/.test(inserted.sliceString(0, 1))) return;
    const before = from > 0 ? tr.startState.sliceDoc(from - 1, from) : "\n";
    if (/\s/.test(before)) startsWord = true;
  });
  return !startsWord;
}

/** The editing keys, and an undo history that steps by word. */
export function editingKeys(): Extension {
  return [
    // Steps are never split by how much time passes between keystrokes.
    history({
      newGroupDelay: Number.MAX_SAFE_INTEGER,
      joinToEvent: joinsUndoStep,
    }),
    keymap.of([
      { key: "Enter", run: continueMarkup },
      { key: "Tab", run: nestItem, shift: outdentItem },
      // Open line: break the line and leave the cursor before the break.
      { key: "Ctrl-Shift-Enter", run: splitLine },
      { key: "Mod-d", run: selectNextOccurrence, preventDefault: true },
      ...historyKeymap,
      ...defaultKeymap,
    ]),
  ];
}
