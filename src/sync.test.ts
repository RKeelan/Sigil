import { afterEach, describe, expect, test } from "bun:test";
import { undo } from "@codemirror/commands";
import { Sigil, type TextChange } from "./editor.ts";

/**
 * A host that holds the document, as VS Code does, and that gets the editor's edits and sends
 * its own changes back only when told to, so that a test can cross them.
 */
class FakeHost {
  text: string;
  version = 0;
  /** The version of the latest change made outside the editor. */
  outside = 0;
  /** Edits the editor has sent that haven't reached the host yet. */
  readonly inbox: { changes: TextChange[]; version: number }[] = [];
  /** Messages the host has sent that haven't reached the editor yet. */
  readonly outbox: (
    | { type: "confirm"; version: number }
    | { type: "edit"; changes: TextChange[]; version: number }
  )[] = [];
  readonly editor: Sigil;

  constructor(text: string) {
    this.text = text;
    this.editor = new Sigil({
      parent: document.body,
      text,
      host: {
        edit: (changes, version) =>
          this.inbox.push({ changes: [...changes], version }),
      },
    });
  }

  /** The host's text, with an edit's changes applied. */
  private apply(changes: readonly TextChange[]) {
    let text = this.text;
    for (const change of [...changes].sort((a, b) => b.from - a.from))
      text = text.slice(0, change.from) + change.insert + text.slice(change.to);
    this.text = text;
  }

  /**
   * The editor's edits reach the host, which applies those made after the latest change from
   * outside.
   */
  receive() {
    for (const edit of this.inbox.splice(0)) {
      if (edit.version < this.outside) continue;
      this.apply(edit.changes);
      this.version++;
      this.outbox.push({ type: "confirm", version: this.version });
    }
  }

  /** The host's text changes outside the editor. */
  change(from: number, to: number, insert: string) {
    const changes = [{ from, to, insert }];
    this.apply(changes);
    this.version++;
    this.outside = this.version;
    this.outbox.push({ type: "edit", changes, version: this.version });
  }

  /** The host's messages reach the editor. */
  send() {
    for (const message of this.outbox.splice(0)) {
      if (message.type === "confirm")
        expect(this.editor.confirmEdit(message.version)).toBe(true);
      else
        expect(this.editor.applyEdit(message.changes, message.version)).toBe(
          true,
        );
    }
  }

  /** Delivers messages both ways until none are left. */
  settle() {
    while (this.inbox.length || this.outbox.length) {
      this.receive();
      this.send();
    }
  }
}

let host: FakeHost | null = null;

function open(text: string): FakeHost {
  host = new FakeHost(text);
  return host;
}

afterEach(() => {
  host?.editor.destroy();
  host = null;
  document.body.innerHTML = "";
});

function type(editor: Sigil, at: number, insert: string, to = at) {
  editor.view.dispatch({
    changes: { from: at, to, insert },
    selection: { anchor: at + insert.length },
    userEvent: "input.type",
  });
}

describe("the host's text", () => {
  test("follows the editor's edits", () => {
    const fake = open("one two");
    type(fake.editor, 3, ",");
    type(fake.editor, 8, "!");
    fake.settle();
    expect(fake.text).toBe("one, two!");
    expect(fake.version).toBe(2);
    expect(fake.editor.version).toBe(2);
  });

  test("keeps edits that crossed a change from outside", () => {
    const fake = open("the cat sat");
    // The user types after "cat" while the host puts "black " before it.
    type(fake.editor, 7, "s");
    type(fake.editor, 8, " also");
    fake.change(4, 4, "black ");
    fake.settle();
    expect(fake.text).toBe("the black cats also sat");
    expect(fake.editor.text).toBe(fake.text);
  });

  test("keeps edits made before an outside change was confirmed", () => {
    const fake = open("abc");
    type(fake.editor, 3, "d");
    fake.receive();
    fake.change(0, 1, "A");
    type(fake.editor, 4, "e");
    fake.settle();
    expect(fake.text).toBe("Abcde");
    expect(fake.editor.text).toBe(fake.text);
  });

  test("keeps edits that crossed a change in a text with Windows line endings", () => {
    const fake = open("one\r\ntwo\r\nthree");
    // After "two", which is at 7 in the editor and 8 in the host's text.
    type(fake.editor, 7, "!");
    fake.change(0, 0, "zero\r\n");
    fake.settle();
    expect(fake.text).toBe("zero\r\none\r\ntwo!\r\nthree");
    expect(fake.editor.text).toBe(fake.text);
  });

  test("puts text inserted at the same place by both in the host's order", () => {
    const fake = open("ab");
    type(fake.editor, 1, "x");
    fake.change(1, 1, "y");
    fake.settle();
    expect(fake.text).toBe("ayxb");
    expect(fake.editor.text).toBe(fake.text);
  });

  test("drops an edit whose text was deleted outside", () => {
    const fake = open("one two three");
    type(fake.editor, 4, "", 7);
    fake.change(3, 8, "");
    fake.settle();
    expect(fake.text).toBe("onethree");
    expect(fake.editor.text).toBe(fake.text);
  });

  test.each([1, 2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47])(
    "stays in step through random crossed edits (seed %d)",
    (start) => {
      let seed = start;
      const random = (n: number) => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed % n;
      };
      const fake = open("The quick brown fox\njumps over\nthe lazy dog.");
      for (let step = 0; step < 400; step++) {
        const choice = random(5);
        if (choice === 0) {
          const length = fake.editor.view.state.doc.length;
          const from = random(length + 1);
          const to = Math.min(length, from + random(4));
          type(
            fake.editor,
            from,
            ["a", "bc", "\n", "", "—"][random(5)] ?? "",
            to,
          );
        } else if (choice === 1) {
          const from = random(fake.text.length + 1);
          const to = Math.min(fake.text.length, from + random(3));
          fake.change(from, to, ["X", "", "yz"][random(3)] ?? "");
        } else if (choice === 2) {
          fake.receive();
        } else if (choice === 3) {
          fake.send();
        } else {
          undo(fake.editor.view);
        }
      }
      fake.settle();
      expect(fake.editor.text).toBe(fake.text);
      fake.editor.destroy();
    },
  );
});

describe("undo", () => {
  test("undoes the user's edit where an outside change has moved it", () => {
    const fake = open("one two");
    type(fake.editor, 7, " three");
    fake.settle();
    fake.change(0, 0, "zero ");
    fake.settle();
    undo(fake.editor.view);
    fake.settle();
    expect(fake.text).toBe("zero one two");
    expect(fake.editor.text).toBe(fake.text);
  });
});

describe("the host", () => {
  test("is not sent a change it made itself", () => {
    const fake = open("abc");
    fake.change(0, 0, "x");
    fake.send();
    expect(fake.inbox).toEqual([]);
  });

  test("can start again from its text when the editor falls out of step", () => {
    const fake = open("abc");
    type(fake.editor, 3, "d");
    expect(fake.editor.applyEdit([{ from: 0, to: 0, insert: "x" }], 5)).toBe(
      false,
    );
    expect(fake.editor.confirmEdit(9)).toBe(false);
    fake.editor.setText("fresh", 5);
    expect(fake.editor.text).toBe("fresh");
    expect(fake.editor.version).toBe(5);
    expect(fake.editor.confirmEdit(1)).toBe(false);
  });
});

describe("keys the editor handles", () => {
  test("go no further than the editor", () => {
    const fake = open("one");
    const reached: string[] = [];
    const listener = (event: KeyboardEvent) => reached.push(event.key);
    window.addEventListener("keydown", listener);
    try {
      for (const [key, shiftKey] of [
        ["z", false],
        ["y", false],
        ["z", true],
        ["q", false],
      ] as const) {
        fake.editor.view.contentDOM.dispatchEvent(
          new KeyboardEvent("keydown", {
            key,
            ctrlKey: true,
            shiftKey,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
    } finally {
      window.removeEventListener("keydown", listener);
    }
    expect(reached).toEqual(["q"]);
  });
});
