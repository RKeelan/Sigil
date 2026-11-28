import type { Sigil, TextChange } from "../src/index.ts";

/** What the demo page puts on `window.sigil`, for a test or an agent driving the browser. */
export interface Demo {
  /** The editor showing the current document. It is replaced when another document is loaded. */
  readonly editor: Sigil;
  /** The document's text, byte for byte. */
  readonly text: string;
  /** The text the demo's host holds as the index, and as `HEAD`. */
  readonly index: string;
  readonly head: string;
  /** Every edit the editor has reported for the current document. */
  readonly edits: TextChange[][];
  /**
   * The file as the demo's host holds it, which the editor's edits are applied to. It matches
   * `text` once the editor's edits have been confirmed.
   */
  readonly file: string;
  /** Changes the file from outside the editor, as another program might. */
  changeFile(changes: TextChange[]): void;
  /** Replaces the file from outside the editor. */
  setFile(text: string): void;
  /** The words added to the stub dictionary. */
  readonly words: string[];
  /** Violations of the page's content security policy. */
  readonly violations: string[];
  /** Loads a sample document by name. */
  load(name: string): void;
}

declare global {
  interface Window {
    sigil: Demo;
  }
}
