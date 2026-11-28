import {
  defaultKeymap,
  history,
  historyKeymap,
  redo,
  splitLine,
  undo,
} from "@codemirror/commands";
import { selectNextOccurrence } from "@codemirror/search";
import type { Extension, Transaction } from "@codemirror/state";
import { keymap, ViewPlugin } from "@codemirror/view";
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

/**
 * Keeps a key the editor has handled from going further up the page. A host that watches for
 * keys on its window, as VS Code's webviews do to pass keys on to the workbench, then acts only
 * on the keys the editor leaves alone.
 */
const keepHandledKeys = ViewPlugin.define((view) => {
  const listener = (event: KeyboardEvent) => {
    if (event.defaultPrevented) event.stopPropagation();
  };
  view.dom.addEventListener("keydown", listener);
  return {
    destroy: () => view.dom.removeEventListener("keydown", listener),
  };
});

/** The editing keys, and an undo history that steps by word. */
export function editingKeys(): Extension {
  return [
    keepHandledKeys,
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
      // Undo and redo are the editor's even when it has nothing to undo or redo, so that a host
      // never undoes the document as well. Redo has both of VS Code's keys.
      { key: "Mod-z", run: undo, preventDefault: true },
      { key: "Mod-y", run: redo, preventDefault: true },
      { key: "Mod-Shift-z", run: redo, preventDefault: true },
      ...historyKeymap,
      ...defaultKeymap,
    ]),
  ];
}
