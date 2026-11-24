import {
  type EditorState,
  type Extension,
  Facet,
  Prec,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  type Command,
  type EditorView,
  keymap,
  showTooltip,
  type Tooltip,
} from "@codemirror/view";

/**
 * A snippet: text offered in place of a trigger typed before the cursor. In the text,
 * `{{cursor}}` marks where the cursor goes and `{{date}}` is replaced by today's date.
 */
export interface Snippet {
  trigger: string;
  text: string;
  /** Offer the snippet only when the trigger is the first thing on its line. */
  lineStart?: boolean;
}

export interface SnippetConfig {
  snippets: readonly Snippet[];
  /** The clock `{{date}}` reads. */
  now: () => Date;
}

const config = Facet.define<SnippetConfig, SnippetConfig>({
  combine: (values) => values[0] ?? { snippets: [], now: () => new Date() },
});

interface Offer {
  snippet: Snippet;
  from: number;
  to: number;
}

const dismiss = StateEffect.define<null>();

/** The snippet whose trigger ends at the cursor, if one does. */
export function snippetAt(
  state: EditorState,
  snippets: readonly Snippet[],
): Offer | null {
  const { main } = state.selection;
  if (!main.empty || state.selection.ranges.length > 1) return null;
  const line = state.doc.lineAt(main.head);
  const before = line.text.slice(0, main.head - line.from);
  let best: Offer | null = null;
  for (const snippet of snippets) {
    const { trigger } = snippet;
    if (!trigger || !before.endsWith(trigger)) continue;
    const lead = before.slice(0, before.length - trigger.length);
    if (
      snippet.lineStart
        ? lead.trim() !== ""
        : /\w$/.test(lead) && /^\w/.test(trigger)
    )
      continue;
    if (!best || trigger.length > best.snippet.trigger.length)
      best = { snippet, from: main.head - trigger.length, to: main.head };
  }
  return best;
}

/** The snippet on offer. It is offered when its trigger is typed, and until the cursor moves. */
const offer = StateField.define<Offer | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(dismiss)) return null;
    if (tr.docChanged && tr.isUserEvent("input.type"))
      return snippetAt(tr.state, tr.state.facet(config).snippets);
    if (tr.docChanged || tr.selection) return null;
    return value;
  },
  provide: (field) =>
    showTooltip.from(field, (value) => (value ? tooltip(value) : null)),
});

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** A snippet's text with the date filled in, and where the cursor goes in it. */
export function expand(
  snippet: Snippet,
  now: Date,
): { text: string; cursor: number } {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const filled = snippet.text.replaceAll("{{date}}", date);
  const cursor = filled.indexOf("{{cursor}}");
  const text = filled.replaceAll("{{cursor}}", "");
  return { text, cursor: cursor < 0 ? text.length : cursor };
}

const accept: Command = (view) => {
  const value = view.state.field(offer, false);
  if (!value) return false;
  const { text, cursor } = expand(
    value.snippet,
    view.state.facet(config).now(),
  );
  const insert = view.state.toText(text);
  view.dispatch({
    changes: { from: value.from, to: value.to, insert },
    selection: { anchor: value.from + cursor },
    scrollIntoView: true,
    userEvent: "input.complete",
  });
  return true;
};

const cancel: Command = (view) => {
  if (!view.state.field(offer, false)) return false;
  view.dispatch({ effects: dismiss.of(null) });
  return true;
};

function tooltip(value: Offer): Tooltip {
  return {
    pos: value.from,
    end: value.to,
    above: false,
    create(view: EditorView) {
      const doc = view.dom.ownerDocument;
      const dom = doc.createElement("div");
      dom.className = "sg-snippet";
      const text = dom.appendChild(doc.createElement("span"));
      text.className = "sg-snippet-text";
      text.textContent = expand(
        value.snippet,
        view.state.facet(config).now(),
      ).text;
      const key = dom.appendChild(doc.createElement("span"));
      key.className = "sg-snippet-key";
      key.textContent = "Tab";
      dom.addEventListener("mousedown", (event) => {
        event.preventDefault();
        accept(view);
      });
      return { dom };
    },
  };
}

/** Offers snippets as their triggers are typed. Tab takes the offer and Escape turns it down. */
export function snippets(value: SnippetConfig): Extension {
  return [
    config.of(value),
    offer,
    Prec.highest(
      keymap.of([
        { key: "Tab", run: accept },
        { key: "Escape", run: cancel },
      ]),
    ),
  ];
}
