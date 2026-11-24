import { describe, expect, test } from "bun:test";
import { redo, undo } from "@codemirror/commands";
import type { EditorState } from "@codemirror/state";
import { marked, stateOf } from "../testing.ts";
import { editingKeys } from "./keymap.ts";

/** Types text a character at a time, as a keyboard does. */
function type(state: EditorState, text: string): EditorState {
  for (const ch of text) {
    const { head } = state.selection.main;
    state = state.update({
      changes: { from: head, insert: ch },
      selection: { anchor: head + 1 },
      userEvent: "input.type",
    }).state;
  }
  return state;
}

function step(command: typeof undo, state: EditorState): EditorState {
  let next = state;
  command({
    state,
    dispatch: (tr) => {
      next = tr.state;
    },
  });
  return next;
}

describe("undo", () => {
  test("steps back a word and the space after it at a time", () => {
    let state = type(stateOf("¦", editingKeys()), "one two  three");
    state = step(undo, state);
    expect(marked(state)).toBe("one two  ¦");
    state = step(undo, state);
    expect(marked(state)).toBe("one ¦");
    state = step(undo, state);
    expect(marked(state)).toBe("¦");
  });

  test("puts the cursor back where it was before the step", () => {
    let state = type(stateOf("before ¦after", editingKeys()), "word");
    state = state.update({ selection: { anchor: 0 } }).state;
    state = step(undo, state);
    expect(marked(state)).toBe("before ¦after");
  });

  test("starts a new step for typing somewhere else", () => {
    let state = type(stateOf("ab ¦cd", editingKeys()), "x");
    state = state.update({ selection: { anchor: 0 } }).state;
    state = type(state, "y");
    state = step(undo, state);
    expect(marked(state)).toBe("¦ab xcd");
  });

  test("takes deletions next to one another as one step", () => {
    let state = stateOf("hello¦", editingKeys());
    for (let i = 0; i < 3; i++) {
      const { head } = state.selection.main;
      state = state.update({
        changes: { from: head - 1, to: head },
        userEvent: "delete.backward",
      }).state;
    }
    expect(marked(state)).toBe("he¦");
    expect(marked(step(undo, state))).toBe("hello¦");
  });

  test("can be redone", () => {
    let state = type(stateOf("¦", editingKeys()), "one two");
    state = step(undo, state);
    expect(marked(step(redo, state))).toBe("one two¦");
  });
});
