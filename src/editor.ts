import { indentUnit } from "@codemirror/language";
import {
  Compartment,
  EditorState,
  type Extension,
  Transaction,
} from "@codemirror/state";
import { drawSelection, EditorView } from "@codemirror/view";
import { bases, changesView, setBases } from "./changes/view.ts";
import { joinLines, offsetIn, splitLines } from "./eol.ts";
import { frontMatterFold, initialCursor } from "./frontmatter.ts";
import { lineNumbers } from "./gutter.ts";
import { editingKeys } from "./keys/keymap.ts";
import { markdownLanguage } from "./markdown/parser.ts";
import { livePreview } from "./render/preview.ts";
import { type Snippet, snippets } from "./snippets.ts";
import { type Misspelling, spellCheck } from "./spell.ts";
import { baseTheme, type Palette, paletteTheme } from "./theme.ts";

/** One replacement in a text: the characters from `from` to `to` become `insert`. */
export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

/**
 * Everything the editor needs from outside itself. Every member is optional: a host that leaves
 * one out goes without what it provides.
 */
export interface Host {
  /**
   * Called with each edit the user makes. The changes are offsets into the document's text as
   * it was before the edit, and none of them overlap.
   */
  edit?(changes: readonly TextChange[]): void;
  /** Checks the spelling of a piece of text, returning the misspelled ranges within it. */
  checkSpelling?(text: string): Promise<readonly Misspelling[]>;
  /** Called when the user adds a word to the dictionary. */
  addWord?(word: string): void;
  /** Called with the index's new text when the user stages or unstages a change. */
  setIndex?(text: string): void;
}

export interface Settings {
  /** Light, dark, or whichever the host is; see `Sigil.setHostTheme`. */
  theme: Palette | "system";
  lineNumbers: boolean;
  /** Whether uncommitted changes are shown, once the host has supplied the texts to compare. */
  showChanges: boolean;
  snippets: readonly Snippet[];
}

export const defaultSettings: Settings = {
  theme: "system",
  lineNumbers: true,
  showChanges: true,
  snippets: [],
};

export interface Options {
  /** The element the editor is put in. */
  parent: Element;
  /** The document's text. */
  text?: string;
  host?: Host;
  settings?: Partial<Settings>;
  /** Whether the host is light or dark, which the System theme follows. */
  hostTheme?: Palette | null;
  /** A nonce for the style elements the editor creates, for pages with a content security policy. */
  nonce?: string;
  /** The clock that snippets take today's date from. */
  now?: () => Date;
}

/** The texts a document's changes are worked out against. */
export interface ChangeBases {
  /** The file as it is in the index. */
  index: string;
  /** The file as it is at `HEAD`. */
  head: string;
}

/** A live-preview Markdown editor. */
export class Sigil {
  /** The CodeMirror view the editor is built on. */
  readonly view: EditorView;
  private current: Settings;
  private hostTheme: Palette | null;
  private eol: string;
  private hasBases = false;
  private readonly host: Host;
  private readonly now: () => Date;
  private readonly theme = new Compartment();
  private readonly numbers = new Compartment();
  private readonly changes = new Compartment();
  private readonly snippetList = new Compartment();
  private readonly recheck: ((view: EditorView) => void) | null = null;
  private readonly scheme: MediaQueryList | null;
  private readonly onScheme = () => this.applyTheme();

  constructor(options: Options) {
    this.host = options.host ?? {};
    this.current = { ...defaultSettings, ...options.settings };
    this.hostTheme = options.hostTheme ?? null;
    this.now = options.now ?? (() => new Date());
    const window = options.parent.ownerDocument.defaultView;
    this.scheme = window?.matchMedia?.("(prefers-color-scheme: dark)") ?? null;
    this.scheme?.addEventListener("change", this.onScheme);

    const { text, eol } = splitLines(options.text ?? "");
    this.eol = eol;
    const extensions: Extension[] = [
      markdownLanguage,
      EditorState.tabSize.of(4),
      indentUnit.of("    "),
      EditorState.allowMultipleSelections.of(true),
      EditorView.lineWrapping,
      // Nothing in the editor animates, the cursor included.
      drawSelection({ cursorBlinkRate: 0 }),
      EditorView.contentAttributes.of({ spellcheck: "false" }),
      livePreview(),
      frontMatterFold(),
      editingKeys(),
      bases,
      this.snippetList.of(this.snippetExtension()),
      this.numbers.of(this.current.lineNumbers ? lineNumbers() : []),
      this.changes.of(this.changesExtension()),
      baseTheme(),
      this.theme.of(paletteTheme(this.palette())),
      EditorView.updateListener.of((update) => {
        for (const tr of update.transactions) this.report(tr);
      }),
    ];
    if (options.nonce) extensions.push(EditorView.cspNonce.of(options.nonce));
    const { checkSpelling } = this.host;
    if (checkSpelling) {
      const spelling = spellCheck({
        check: (piece) => checkSpelling.call(this.host, piece),
        addWord: this.host.addWord
          ? (word) => this.host.addWord?.(word)
          : undefined,
      });
      extensions.push(spelling.extension);
      this.recheck = spelling.recheck;
    }
    let state = EditorState.create({ doc: text, extensions });
    state = state.update({ selection: { anchor: initialCursor(state) } }).state;
    this.view = new EditorView({ state, parent: options.parent });
  }

  /** The document's text, with the line endings it was given with. */
  get text(): string {
    return joinLines(this.view.state.doc, this.eol);
  }

  /**
   * Replaces the document's text with text changed outside the editor. Only the part that
   * differs is replaced, so the cursor and undo history survive, and the change is not reported
   * back to the host.
   */
  setText(source: string) {
    const { text, eol } = splitLines(source);
    this.eol = eol;
    const before = this.view.state.doc.toString();
    const after = text.toString();
    if (before === after) return;
    let from = 0;
    const shorter = Math.min(before.length, after.length);
    while (from < shorter && before[from] === after[from]) from++;
    let endBefore = before.length;
    let endAfter = after.length;
    while (
      endBefore > from &&
      endAfter > from &&
      before[endBefore - 1] === after[endAfter - 1]
    ) {
      endBefore--;
      endAfter--;
    }
    this.view.dispatch({
      changes: { from, to: endBefore, insert: after.slice(from, endAfter) },
      annotations: [
        Transaction.remote.of(true),
        Transaction.addToHistory.of(false),
      ],
    });
  }

  get settings(): Settings {
    return this.current;
  }

  /** Changes some of the settings, leaving the rest as they are. */
  setSettings(settings: Partial<Settings>) {
    this.current = { ...this.current, ...settings };
    this.view.dispatch({
      effects: [
        this.theme.reconfigure(paletteTheme(this.palette())),
        this.numbers.reconfigure(this.current.lineNumbers ? lineNumbers() : []),
        this.changes.reconfigure(this.changesExtension()),
        this.snippetList.reconfigure(this.snippetExtension()),
      ],
    });
  }

  /**
   * Says whether the host is light or dark, which the System theme follows. Given null, System
   * follows the page's `prefers-color-scheme` instead.
   */
  setHostTheme(theme: Palette | null) {
    this.hostTheme = theme;
    this.applyTheme();
  }

  /**
   * Supplies the texts that changes are worked out against, or null when there are none, as for
   * a file that isn't in a repository.
   */
  setChanges(texts: ChangeBases | null) {
    let value = null;
    if (texts) {
      const index = splitLines(texts.index);
      value = {
        head: splitLines(texts.head).text,
        index: index.text,
        indexEol: index.eol,
      };
    }
    const had = this.hasBases;
    this.hasBases = value !== null;
    this.view.dispatch({
      effects:
        had === this.hasBases
          ? setBases.of(value)
          : [
              setBases.of(value),
              this.changes.reconfigure(this.changesExtension()),
            ],
    });
  }

  /** Checks the spelling of the text in view again, as after the dictionary changes. */
  recheckSpelling() {
    this.recheck?.(this.view);
  }

  focus() {
    this.view.focus();
  }

  destroy() {
    this.scheme?.removeEventListener("change", this.onScheme);
    this.view.destroy();
  }

  private palette(): Palette {
    if (this.current.theme !== "system") return this.current.theme;
    if (this.hostTheme) return this.hostTheme;
    return this.scheme?.matches ? "dark" : "light";
  }

  private applyTheme() {
    this.view.dispatch({
      effects: this.theme.reconfigure(paletteTheme(this.palette())),
    });
  }

  private changesExtension(): Extension {
    // Without texts to compare with there are no changes to show, and no room is kept for them.
    if (!this.current.showChanges || !this.hasBases) return [];
    return changesView((text) => this.host.setIndex?.(text));
  }

  private snippetExtension(): Extension {
    return snippets({ snippets: this.current.snippets, now: this.now });
  }

  /** Tells the host about an edit, unless the edit came from the host. */
  private report(tr: Transaction) {
    if (!tr.docChanged || tr.annotation(Transaction.remote)) return;
    const { edit } = this.host;
    if (!edit) return;
    const before = tr.startState.doc;
    const changes: TextChange[] = [];
    tr.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
      changes.push({
        from: offsetIn(before, from, this.eol),
        to: offsetIn(before, to, this.eol),
        insert: joinLines(inserted, this.eol),
      });
    });
    edit.call(this.host, changes);
  }
}
