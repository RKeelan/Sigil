import { indentUnit } from "@codemirror/language";
import {
  ChangeSet,
  Compartment,
  EditorState,
  type Extension,
  Transaction,
} from "@codemirror/state";
import { drawSelection, EditorView } from "@codemirror/view";
import { bases, changesView, setBases } from "./changes/view.ts";
import { joinLines, offsetIn, positionIn, splitLines } from "./eol.ts";
import { frontMatterFold, initialCursor } from "./frontmatter.ts";
import { lineNumbers } from "./gutter.ts";
import { editingKeys } from "./keys/keymap.ts";
import { markdownLanguage } from "./markdown/parser.ts";
import { backgrounds } from "./render/backgrounds.ts";
import {
  livePreview,
  type RevealScope,
  revealScope,
} from "./render/preview.ts";
import { type Snippet, snippets } from "./snippets.ts";
import { type Misspelling, spellCheck } from "./spell.ts";
import { Sync, type Unconfirmed } from "./sync.ts";
import {
  baseTheme,
  measureTheme,
  type Palette,
  paletteTheme,
} from "./theme.ts";

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
   * Called with each edit the user makes, and `version`, the version of the host's text that the
   * editor knew of when the user made it. The changes are offsets into the host's text with the
   * editor's earlier edits applied, and none of them overlap. The host applies an edit only if
   * nothing but the editor has changed its text since `version`, and then calls
   * `Sigil.confirmEdit` with the version the edit made. It ignores any other edit: the editor
   * sends it again, with a newer version, once the host has told it of the change that came
   * first.
   */
  edit?(changes: readonly TextChange[], version: number): void;
  /** Checks the spelling of a piece of text, returning the misspelled ranges within it. */
  checkSpelling?(text: string): Promise<readonly Misspelling[]>;
  /** Called when the user adds a word to the dictionary. */
  addWord?(word: string): void;
  /** Called with the index's new text when the user stages a change. */
  setIndex?(text: string): void;
}

export interface Settings {
  /** Light, dark, or whichever the host is; see `Sigil.setHostTheme`. */
  theme: Palette | "system";
  lineNumbers: boolean;
  /**
   * The length of a line of text, in characters of English prose, or null to fill the view. The
   * text is set in a column this wide, centred in the view.
   */
  measure: number | null;
  /**
   * How much raw source the cursor reveals: the whole of each line it is on, or only the
   * constructs it touches. See docs/design.md for what counts as a construct.
   */
  reveal: RevealScope;
  /** Whether unstaged changes are shown, once the host has supplied the index to compare with. */
  showChanges: boolean;
  snippets: readonly Snippet[];
}

export const defaultSettings: Settings = {
  theme: "system",
  lineNumbers: true,
  measure: 90,
  reveal: "line",
  showChanges: true,
  snippets: [],
};

export interface Options {
  /** The element the editor is put in. */
  parent: Element;
  /** The document's text. */
  text?: string;
  /**
   * The version of the host's text that `text` is. The host's version goes up by one with each
   * change to its text, whether the editor made the change or something else did.
   */
  version?: number;
  host?: Host;
  settings?: Partial<Settings>;
  /** Whether the host is light or dark, which the System theme follows. */
  hostTheme?: Palette | null;
  /** A nonce for the style elements the editor creates, for pages with a content security policy. */
  nonce?: string;
  /** The clock that snippets take today's date from. */
  now?: () => Date;
}

/**
 * The text a document's changes are worked out against: the file as it is in the index. Staged
 * changes are in the index, so they show as plain text; the host offers unstaging, and supplies
 * the index again afterwards.
 */
export interface ChangeBases {
  index: string;
}

/** A live-preview Markdown editor. */
export class Sigil {
  /** The CodeMirror view the editor is built on. */
  readonly view: EditorView;
  private current: Settings;
  private hostTheme: Palette | null;
  private eol: string;
  private readonly sync: Sync;
  private hasBases = false;
  private readonly host: Host;
  private readonly now: () => Date;
  private readonly theme = new Compartment();
  private readonly numbers = new Compartment();
  private readonly measure = new Compartment();
  private readonly scope = new Compartment();
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
    this.sync = new Sync(text, options.version ?? 0);
    const extensions: Extension[] = [
      markdownLanguage,
      EditorState.tabSize.of(4),
      indentUnit.of("    "),
      EditorState.allowMultipleSelections.of(true),
      EditorView.lineWrapping,
      // Nothing in the editor animates, the cursor included.
      drawSelection({ cursorBlinkRate: 0 }),
      backgrounds(),
      EditorView.contentAttributes.of({ spellcheck: "false" }),
      this.scope.of(revealScope.of(this.current.reveal)),
      livePreview(),
      frontMatterFold(),
      editingKeys(),
      bases,
      this.snippetList.of(this.snippetExtension()),
      this.numbers.of(this.current.lineNumbers ? lineNumbers() : []),
      this.changes.of(this.changesExtension()),
      baseTheme(),
      this.theme.of(paletteTheme(this.palette())),
      this.measure.of(measureTheme(this.current.measure)),
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
    let state = EditorState.create({ doc: this.sync.doc, extensions });
    state = state.update({ selection: { anchor: initialCursor(state) } }).state;
    this.view = new EditorView({ state, parent: options.parent });
  }

  /** The document's text, with the line endings it was given with. */
  get text(): string {
    return joinLines(this.view.state.doc, this.eol);
  }

  /** The version of the host's text that the editor knows of. */
  get version(): number {
    return this.sync.version;
  }

  /**
   * Replaces the document's text with the host's text at `version`, dropping any edits the host
   * hasn't confirmed. Only the part that differs is replaced, so the cursor and undo history
   * survive, and the change is not reported back to the host. A host that can say what changed
   * calls `applyEdit` instead, which keeps the user's unconfirmed edits.
   */
  setText(source: string, version = this.sync.version) {
    const { text, eol } = splitLines(source);
    this.eol = eol;
    this.sync.reset(text, version);
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

  /**
   * Applies a change to the host's text made outside the editor, which made it `version`. The
   * changes are offsets into the host's text at the version before, and none of them overlap.
   * The user's edits that the host hasn't confirmed are kept, and sent to the host again, made to
   * `version`. Returns false, and changes nothing, if `version` isn't the one after the
   * editor's; the host then calls `setText` to start again from its text.
   */
  applyEdit(changes: readonly TextChange[], version: number): boolean {
    const doc = this.sync.doc;
    const outside = ChangeSet.of(
      changes.map((change) => ({
        from: positionIn(doc, change.from, this.eol),
        to: positionIn(doc, change.to, this.eol),
        insert: splitLines(change.insert).text,
      })),
      doc.length,
    );
    const result = this.sync.remote(outside, version);
    if (!result) return false;
    this.view.dispatch({
      changes: result.changes,
      annotations: [
        Transaction.remote.of(true),
        Transaction.addToHistory.of(false),
      ],
    });
    for (const edit of result.resend) this.send(edit);
    return true;
  }

  /**
   * Tells the editor that the host has applied the oldest edit it was sent, which made its text
   * `version`. Returns false if the editor wasn't waiting for that version.
   */
  confirmEdit(version: number): boolean {
    return this.sync.confirm(version);
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
        this.measure.reconfigure(measureTheme(this.current.measure)),
        this.scope.reconfigure(revealScope.of(this.current.reveal)),
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
   * Supplies the text that changes are worked out against, or null when there is none, as for a
   * file that isn't in a repository.
   */
  setChanges(texts: ChangeBases | null) {
    let value = null;
    if (texts) {
      const index = splitLines(texts.index);
      value = { index: index.text, indexEol: index.eol };
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
    if (!this.host.edit) return;
    this.send(this.sync.local(tr.changes));
  }

  private send({ changes: set, doc, version }: Unconfirmed) {
    const changes: TextChange[] = [];
    set.iterChanges((from, to, _fromB, _toB, inserted) => {
      changes.push({
        from: offsetIn(doc, from, this.eol),
        to: offsetIn(doc, to, this.eol),
        insert: joinLines(inserted, this.eol),
      });
    });
    this.host.edit?.(changes, version);
  }
}
