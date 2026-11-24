import { syntaxTree } from "@codemirror/language";
import {
  type ChangeDesc,
  type EditorState,
  type Extension,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  type PluginValue,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { frontMatterEnd } from "./markdown/parser.ts";

/** A misspelled stretch of the text that was checked, as offsets into that text. */
export interface Misspelling {
  from: number;
  to: number;
}

export interface SpellConfig {
  /** Checks a piece of text, which is always whole lines. */
  check: (text: string) => Promise<readonly Misspelling[]>;
  /** Told when the user adds a word to the dictionary. */
  addWord?: (word: string) => void;
  /** How long to wait after an edit before checking, in milliseconds. */
  delay?: number;
}

interface Span {
  from: number;
  to: number;
}

const setMisspelt = StateEffect.define<{ span: Span; found: Span[] }>();
const forgetWord = StateEffect.define<string>();

const misspelt = Decoration.mark({ class: "sg-misspelt" });

/** The misspellings found so far. One that is edited is dropped until it is checked again. */
const misspellings = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    if (tr.docChanged) {
      const touched: Span[] = [];
      tr.changes.iterChangedRanges((_fromA, _toA, from, to) => {
        touched.push({ from, to });
      });
      value = value.map(tr.changes).update({
        filter: (from, to) =>
          from < to &&
          !touched.some((span) => span.from <= to && span.to >= from),
      });
    }
    for (const effect of tr.effects) {
      if (effect.is(setMisspelt)) {
        const { span, found } = effect.value;
        value = value.update({
          filterFrom: span.from,
          filterTo: span.to,
          filter: () => false,
          add: found.map((word) => misspelt.range(word.from, word.to)),
          sort: true,
        });
      } else if (effect.is(forgetWord)) {
        value = value.update({
          filter: (from, to) => tr.state.sliceDoc(from, to) !== effect.value,
        });
      }
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** The misspellings marked in a document, in order. */
export function misspellingsIn(state: EditorState): Misspelling[] {
  const found: Misspelling[] = [];
  state.field(misspellings, false)?.between(0, state.doc.length, (from, to) => {
    found.push({ from, to });
  });
  return found;
}

/** Syntax whose text isn't prose, and so isn't checked. */
const unchecked =
  /^(InlineCode|FencedCode|CodeBlock|URL|Autolink|LinkLabel|LinkReference|HTMLTag|HTMLBlock|Comment|CommentBlock|ProcessingInstruction|ProcessingInstructionBlock)$/;

/** Whether a stretch of the document is prose, as opposed to code, an address or front matter. */
export function isProse(state: EditorState, from: number, to: number): boolean {
  if (from < frontMatterEnd(state.doc)) return false;
  const tree = syntaxTree(state);
  for (const pos of [from, to]) {
    const side = pos === from ? 1 : -1;
    for (
      let node = tree.resolveInner(pos, side);
      node.parent;
      node = node.parent
    )
      if (unchecked.test(node.name)) return false;
  }
  return true;
}

/** The parts of `span` that none of `covered`, which is sorted, overlaps. */
export function subtract(span: Span, covered: readonly Span[]): Span[] {
  const out: Span[] = [];
  let from = span.from;
  for (const part of covered) {
    if (part.to <= from) continue;
    if (part.from >= span.to) break;
    if (part.from > from) out.push({ from, to: part.from });
    from = Math.max(from, part.to);
  }
  if (from < span.to) out.push({ from, to: span.to });
  return out;
}

/** Adds a span to a sorted list of spans, merging it with any it touches. */
export function addSpan(spans: readonly Span[], span: Span): Span[] {
  const out: Span[] = [];
  let merged = { ...span };
  for (const part of spans) {
    if (part.to < merged.from) out.push(part);
    else if (part.from > merged.to) {
      out.push(merged);
      merged = part;
    } else {
      merged = {
        from: Math.min(part.from, merged.from),
        to: Math.max(part.to, merged.to),
      };
    }
  }
  out.push(merged);
  return out;
}

/** The longest stretch of text handed over in one request. */
const chunk = 8000;

class Checker implements PluginValue {
  /** The text that has been checked, or is being checked, as sorted spans of whole lines. */
  private checked: Span[] = [];
  /** Requests in flight, each with the changes made to the document since it was sent. */
  private pending = new Set<{ span: Span; changes: ChangeDesc | null }>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private menu: HTMLElement | null = null;
  private destroyed = false;
  private readonly closeMenu = () => this.hideMenu();

  constructor(
    private readonly view: EditorView,
    private readonly config: SpellConfig,
  ) {
    this.schedule(0);
  }

  update(update: ViewUpdate) {
    if (update.docChanged) {
      this.hideMenu();
      const { doc } = update.state;
      // What an edit touches is checked again, a whole line at a time.
      let checked = this.checked.map((span) => ({
        from: update.changes.mapPos(span.from, 1),
        to: update.changes.mapPos(span.to, -1),
      }));
      update.changes.iterChangedRanges((_fromA, _toA, from, to) => {
        const edited = {
          from: doc.lineAt(from).from,
          to: Math.min(doc.lineAt(to).to + 1, doc.length),
        };
        checked = checked.flatMap((span) => subtract(span, [edited]));
      });
      this.checked = checked.filter((span) => span.from < span.to);
      for (const request of this.pending)
        request.changes = request.changes
          ? request.changes.composeDesc(update.changes.desc)
          : update.changes.desc;
    }
    if (update.docChanged || update.viewportChanged)
      this.schedule(this.config.delay ?? 300);
  }

  /** Forgets what has been checked, so that everything in view is checked afresh. */
  recheck() {
    this.checked = [];
    this.schedule(0);
  }

  private schedule(delay: number) {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.destroyed) this.run();
    }, delay);
  }

  /** Sends off whatever is in view and hasn't been checked. */
  private run() {
    const { doc } = this.view.state;
    for (const visible of this.view.visibleRanges) {
      // A checked span runs from the start of a line to the start of the line after its last.
      const lines = {
        from: doc.lineAt(visible.from).from,
        to: Math.min(doc.lineAt(visible.to).to + 1, doc.length),
      };
      for (const gap of subtract(lines, this.checked)) {
        let from = doc.lineAt(gap.from).from;
        const last = gap.to >= doc.length ? doc.length : gap.to - 1;
        if (last < from) continue;
        const end = doc.lineAt(last).to;
        while (from <= end) {
          const to = doc.lineAt(Math.min(from + chunk, end)).to;
          this.request({ from, to });
          from = to + 1;
        }
      }
    }
  }

  /** Has the host check the lines from `span.from` to `span.to`. */
  private request(span: Span) {
    const { doc } = this.view.state;
    this.checked = addSpan(this.checked, {
      from: span.from,
      to: Math.min(span.to + 1, doc.length),
    });
    if (span.from >= span.to) return;
    const request = { span, changes: null as ChangeDesc | null };
    this.pending.add(request);
    const text = this.view.state.sliceDoc(span.from, span.to);
    this.config.check(text).then(
      (found) => {
        this.pending.delete(request);
        if (!this.destroyed) this.receive(request, found);
      },
      () => {
        this.pending.delete(request);
      },
    );
  }

  private receive(
    request: { span: Span; changes: ChangeDesc | null },
    found: readonly Misspelling[],
  ) {
    const { changes } = request;
    const { state } = this.view;
    const kept: Span[] = [];
    for (const word of found) {
      let from = request.span.from + word.from;
      let to = request.span.from + word.to;
      if (changes) {
        // A word that was edited while the request was out is left to the next check.
        if (changes.touchesRange(from, to)) continue;
        from = changes.mapPos(from, 1);
        to = changes.mapPos(to, -1);
      }
      if (from >= to || to > state.doc.length) continue;
      if (isProse(state, from, to)) kept.push({ from, to });
    }
    kept.sort((a, b) => a.from - b.from);
    const span = changes
      ? {
          from: changes.mapPos(request.span.from, 1),
          to: changes.mapPos(request.span.to, -1),
        }
      : request.span;
    if (span.from > span.to) return;
    this.view.dispatch({ effects: setMisspelt.of({ span, found: kept }) });
  }

  /** Offers to add a misspelled word to the dictionary, when one is right-clicked. */
  contextMenu(event: MouseEvent): boolean {
    const { addWord } = this.config;
    if (!addWord) return false;
    const pos = this.view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos === null) return false;
    let word: Span | null = null;
    this.view.state.field(misspellings).between(pos, pos, (from, to) => {
      word = { from, to };
    });
    if (!word) return false;
    const { from, to } = word as Span;
    const text = this.view.state.sliceDoc(from, to);
    this.hideMenu();
    const doc = this.view.dom.ownerDocument;
    const menu = doc.createElement("div");
    menu.className = "sg-menu";
    menu.setAttribute("role", "menu");
    const item = menu.appendChild(doc.createElement("button"));
    item.type = "button";
    item.className = "sg-menu-item";
    item.setAttribute("role", "menuitem");
    item.textContent = `Add “${text}” to dictionary`;
    item.addEventListener("mousedown", (e) => e.preventDefault());
    item.addEventListener("click", () => {
      this.hideMenu();
      addWord(text);
      this.view.dispatch({ effects: forgetWord.of(text) });
      this.view.focus();
    });
    // The menu is placed within the editor, at the pointer, and kept inside the editor's edges.
    // The pointer's position is divided by the editor's scale in case the page is zoomed.
    const { dom } = this.view;
    dom.appendChild(menu);
    const box = dom.getBoundingClientRect();
    const left = (event.clientX - box.left) / (this.view.scaleX || 1);
    const top = (event.clientY - box.top) / (this.view.scaleY || 1);
    const maxLeft = dom.clientWidth - menu.offsetWidth - 4;
    const maxTop = dom.clientHeight - menu.offsetHeight - 4;
    menu.style.left = `${Math.max(0, Math.min(left, maxLeft))}px`;
    menu.style.top = `${Math.max(0, Math.min(top, maxTop))}px`;
    this.menu = menu;
    doc.addEventListener("mousedown", this.onOutside, true);
    doc.addEventListener("keydown", this.closeMenu, true);
    this.view.scrollDOM.addEventListener("scroll", this.closeMenu);
    return true;
  }

  private readonly onOutside = (event: Event) => {
    if (!this.menu?.contains(event.target as Node)) this.hideMenu();
  };

  private hideMenu() {
    if (!this.menu) return;
    this.menu.remove();
    this.menu = null;
    const doc = this.view.dom.ownerDocument;
    doc.removeEventListener("mousedown", this.onOutside, true);
    doc.removeEventListener("keydown", this.closeMenu, true);
    this.view.scrollDOM.removeEventListener("scroll", this.closeMenu);
  }

  destroy() {
    this.destroyed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.hideMenu();
  }
}

/**
 * Marks misspellings in the text that is in view. The checking itself is the host's: it is given
 * text and returns the misspelled ranges, so it can use whatever dictionaries the user has.
 */
export function spellCheck(config: SpellConfig): {
  extension: Extension;
  recheck: (view: EditorView) => void;
} {
  const plugin = ViewPlugin.define((view) => new Checker(view, config), {
    eventHandlers: {
      contextmenu(event) {
        if (!this.contextMenu(event)) return false;
        event.preventDefault();
        return true;
      },
    },
  });
  return {
    extension: [misspellings, plugin],
    recheck: (view) => view.plugin(plugin)?.recheck(),
  };
}
