import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { INDENT, QUOTE } from "./render/pieces.ts";

export type Palette = "light" | "dark";

/** The font Markdown is set in. */
export const serif =
  '"Source Serif 4 Variable", "Source Serif 4", "Source Serif Pro", Georgia, serif';

/** The font of code spans and fences. */
export const mono =
  '"IBM Plex Mono", ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace';

/** The size of headings, by level, relative to the text. */
const headings = [1.9, 1.5, 1.25, 1.1, 1, 1];
const headingLeading = 1.25;
const headingWeight = "650";

// The component's colours are its own. Nothing here is taken from the page it is on.
const palettes: Record<Palette, Record<string, string>> = {
  light: {
    "--sg-bg": "#fbfaf7",
    "--sg-fg": "#24211d",
    "--sg-muted": "#857e72",
    "--sg-faint": "#b3ada2",
    "--sg-rule": "#d8d2c7",
    "--sg-code-bg": "#f0ede6",
    "--sg-link": "#1c5a9e",
    "--sg-selection": "#cfe0f4",
    "--sg-misspelt": "#c8372d",
    "--sg-surface": "#ffffff",
    "--sg-added": "#dff2dc",
    "--sg-added-text": "#b4e2ae",
    "--sg-added-bar": "#3a9d46",
    "--sg-removed": "#fbe4e1",
    "--sg-removed-text": "#f3b9b3",
    "--sg-removed-bar": "#cf4338",
    "--sg-staged": "#e4e9f6",
    "--sg-staged-text": "#c3cfee",
    "--sg-staged-bar": "#6f86c9",
    "--sg-tok-keyword": "#8b3a74",
    "--sg-tok-literal": "#a3501a",
    "--sg-tok-string": "#3c6e27",
    "--sg-tok-function": "#7a5410",
    "--sg-tok-type": "#106a6a",
    "--sg-tok-property": "#2a5a9a",
    "--sg-tok-deleted": "#b2352b",
  },
  dark: {
    "--sg-bg": "#1c1b19",
    "--sg-fg": "#e3dfd6",
    "--sg-muted": "#938c80",
    "--sg-faint": "#635e55",
    "--sg-rule": "#3b3832",
    "--sg-code-bg": "#272522",
    "--sg-link": "#84b4ea",
    "--sg-selection": "#2c4666",
    "--sg-misspelt": "#ee6b5f",
    "--sg-surface": "#2a2825",
    "--sg-added": "#1d3421",
    "--sg-added-text": "#2c5a34",
    "--sg-added-bar": "#4fae5a",
    "--sg-removed": "#3d201e",
    "--sg-removed-text": "#6c2d29",
    "--sg-removed-bar": "#d9574b",
    "--sg-staged": "#232b40",
    "--sg-staged-text": "#374672",
    "--sg-staged-bar": "#7d93d6",
    "--sg-tok-keyword": "#d197c4",
    "--sg-tok-literal": "#e3a274",
    "--sg-tok-string": "#a5c98a",
    "--sg-tok-function": "#d8bd7a",
    "--sg-tok-type": "#77c2bd",
    "--sg-tok-property": "#8db4e6",
    "--sg-tok-deleted": "#e8877d",
  },
};

const rule = "var(--sg-rule)";

/** The margin rule: two 1px lines, 2px apart, down the inner edge of the gutter. */
const marginRule = `linear-gradient(to right, ${rule} 0 1px, transparent 1px 3px, ${rule} 3px 4px)`;

const headingRules: Record<string, Record<string, string>> = {};
headings.forEach((size, i) => {
  headingRules[`.sg-h${i + 1}`] = { fontSize: `${size}em` };
  // The strut that lines a heading's number up with the heading's baseline.
  headingRules[`.sg-number-h${i + 1}::before`] = {
    content: '"\\200b"',
    fontSize: `${size}em`,
    lineHeight: String(headingLeading),
    fontWeight: headingWeight,
  };
});

const styles = EditorView.theme({
  "&": {
    color: "var(--sg-fg)",
    backgroundColor: "var(--sg-bg)",
    "--sg-pad": "1.1em",
  },
  "&.sg-light": palettes.light,
  "&.sg-dark": palettes.dark,
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: serif,
    lineHeight: "1.55",
    overflowX: "hidden",
  },
  ".cm-content": {
    padding: "1em 0 2em",
    caretColor: "var(--sg-fg)",
    tabSize: "4",
    fontVariantNumeric: "lining-nums",
  },
  ".cm-line, .sg-line": {
    padding: "0 1.4em 0 var(--sg-pad)",
    position: "relative",
  },
  ".sg-line": {
    whiteSpace: "break-spaces",
    wordBreak: "break-word",
    overflowWrap: "anywhere",
    tabSize: "4",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeft: "1.5px solid var(--sg-fg)",
  },
  ".cm-selectionBackground": { backgroundColor: "var(--sg-selection)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
    backgroundColor: "var(--sg-selection)",
  },

  // The gutter.
  ".cm-gutters": {
    backgroundColor: "var(--sg-bg)",
    color: "var(--sg-faint)",
    border: "none",
  },
  ".cm-gutters.cm-gutters-before": {
    paddingRight: "4px",
    backgroundImage: marginRule,
    backgroundSize: "4px 100%",
    backgroundPosition: "right top",
    backgroundRepeat: "no-repeat",
  },
  ".sg-numbers": { fontVariantNumeric: "tabular-nums lining-nums" },
  ".sg-numbers .cm-gutterElement": {
    padding: "0 0.75em 0 0.9em",
    textAlign: "right",
    boxSizing: "border-box",
    minWidth: "100%",
  },
  ".cm-activeLineGutter": { backgroundColor: "transparent" },
  "&.cm-focused .sg-numbers .cm-activeLineGutter": { color: "var(--sg-fg)" },

  // Inline formatting.
  ".sg-syntax": { color: "var(--sg-faint)" },
  ".sg-em": { fontStyle: "italic" },
  ".sg-strong": { fontWeight: headingWeight },
  ".sg-strike": { textDecoration: "line-through" },
  ".sg-mono, .sg-code, .sg-html": { fontFamily: mono, fontSize: "0.9em" },
  ".sg-code": {
    backgroundColor: "var(--sg-code-bg)",
    borderRadius: "3px",
    padding: "0.08em 0.25em",
  },
  ".sg-html, .sg-html-line": { color: "var(--sg-muted)" },
  ".sg-link": {
    color: "var(--sg-link)",
    textDecoration: "underline",
    textDecorationThickness: "1px",
    textUnderlineOffset: "0.16em",
  },
  ".sg-done": { color: "var(--sg-muted)" },
  ".sg-image": { maxWidth: "100%", verticalAlign: "bottom" },

  // Headings.
  ".sg-h": { fontWeight: headingWeight, lineHeight: String(headingLeading) },
  ".sg-h6": { color: "var(--sg-muted)" },
  ...headingRules,
  ".sg-rule": {
    display: "inline-block",
    width: "100%",
    height: "0",
    borderTop: `1px solid ${rule}`,
    verticalAlign: "middle",
  },

  // What comes before a line's content: quote bars, indentation and list markers.
  ".sg-box": {
    display: "inline-block",
    textIndent: "0",
    whiteSpace: "pre",
  },
  ".sg-quote": { width: `${QUOTE}em` },
  ".sg-quote::before": {
    content: '""',
    position: "absolute",
    top: "0",
    bottom: "0",
    width: "3px",
    backgroundColor: rule,
  },
  ".sg-unseen": { color: "transparent" },
  ".sg-marker": {
    minWidth: `${INDENT}em`,
    textAlign: "right",
    color: "var(--sg-muted)",
  },
  ".sg-ordered": { fontVariantNumeric: "tabular-nums lining-nums" },
  ".sg-task": {
    display: "inline-block",
    position: "relative",
    boxSizing: "border-box",
    width: "0.9em",
    height: "0.9em",
    marginRight: "0.2em",
    verticalAlign: "-0.08em",
    border: "1.5px solid var(--sg-muted)",
    borderRadius: "2px",
    cursor: "pointer",
  },
  ".sg-task-checked": { backgroundColor: "var(--sg-muted)" },
  ".sg-task-checked::after": {
    content: '""',
    position: "absolute",
    left: "0.2em",
    top: "0.02em",
    width: "0.2em",
    height: "0.42em",
    border: "solid var(--sg-bg)",
    borderWidth: "0 0.12em 0.12em 0",
    transform: "rotate(45deg)",
  },

  // Code blocks and front matter.
  ".sg-code-line": { backgroundColor: "var(--sg-code-bg)" },
  ".sg-code-info": { color: "var(--sg-muted)" },
  // The tokens of a fenced block's code, by role. A monospaced font is as wide in every weight
  // and slant, so the code's columns stay lined up.
  ".sg-tok-comment": { color: "var(--sg-muted)", fontStyle: "italic" },
  ".sg-tok-keyword": { color: "var(--sg-tok-keyword)" },
  ".sg-tok-literal": { color: "var(--sg-tok-literal)" },
  ".sg-tok-string, .sg-tok-inserted": { color: "var(--sg-tok-string)" },
  ".sg-tok-function": { color: "var(--sg-tok-function)" },
  ".sg-tok-type": { color: "var(--sg-tok-type)" },
  ".sg-tok-property": { color: "var(--sg-tok-property)" },
  ".sg-tok-deleted": { color: "var(--sg-tok-deleted)" },
  ".sg-tok-heading": {
    color: "var(--sg-tok-keyword)",
    fontWeight: headingWeight,
  },
  ".sg-tok-strong": { fontWeight: headingWeight },
  ".sg-tok-em": { fontStyle: "italic" },
  ".sg-tok-link": { color: "var(--sg-link)" },
  ".sg-front-matter": { color: "var(--sg-muted)" },
  ".sg-fold": {
    fontFamily: mono,
    fontSize: "0.8em",
    color: "var(--sg-muted)",
    border: `1px solid ${rule}`,
    borderRadius: "3px",
    padding: "0.1em 0.5em",
    cursor: "pointer",
  },
  ".sg-fold-open": { marginLeft: "1em" },

  // Tables.
  ".sg-row": {
    display: "inline-grid",
    verticalAlign: "top",
    textIndent: "0",
    whiteSpace: "normal",
  },
  ".sg-cell": {
    minWidth: "0",
    padding: "0 0.7em",
    boxSizing: "border-box",
    overflowWrap: "anywhere",
    whiteSpace: "pre-wrap",
  },
  ".sg-row-header": { fontWeight: headingWeight },
  ".sg-row-delimiter": {
    backgroundImage: `linear-gradient(${rule}, ${rule})`,
    backgroundSize: "100% 1px",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
  },
  ".sg-row-delimiter .sg-cell::before": { content: '"\\200b"' },

  // Spelling.
  ".sg-misspelt": {
    textDecoration: "underline wavy var(--sg-misspelt)",
    textDecorationThickness: "1px",
    textDecorationSkipInk: "none",
    textUnderlineOffset: "0.2em",
  },
  ".sg-menu": {
    position: "absolute",
    zIndex: "400",
    backgroundColor: "var(--sg-surface)",
    border: `1px solid ${rule}`,
    borderRadius: "4px",
    padding: "0.25em",
    boxShadow: "0 2px 8px rgb(0 0 0 / 0.18)",
  },
  ".sg-menu-item, .sg-action, .sg-action-spacer": {
    font: "inherit",
    fontFamily: mono,
    fontSize: "0.8em",
    color: "var(--sg-fg)",
    backgroundColor: "transparent",
    border: "none",
    borderRadius: "3px",
    cursor: "pointer",
  },
  ".sg-menu-item": { padding: "0.3em 0.7em", whiteSpace: "nowrap" },
  ".sg-menu-item:hover, .sg-menu-item:focus": {
    backgroundColor: "var(--sg-code-bg)",
    outline: "none",
  },

  // Snippets.
  ".cm-tooltip": {
    backgroundColor: "var(--sg-surface)",
    border: `1px solid ${rule}`,
    borderRadius: "4px",
    color: "var(--sg-fg)",
  },
  ".sg-snippet": {
    display: "flex",
    alignItems: "baseline",
    gap: "0.9em",
    padding: "0.2em 0.6em",
    maxWidth: "30em",
    cursor: "pointer",
    fontFamily: serif,
  },
  ".sg-snippet-text": {
    whiteSpace: "pre-wrap",
    overflow: "hidden",
    maxHeight: "6.2em",
  },
  ".sg-snippet-key": {
    fontFamily: mono,
    fontSize: "0.75em",
    color: "var(--sg-muted)",
    border: `1px solid ${rule}`,
    borderRadius: "3px",
    padding: "0 0.4em",
  },

  // Changes. Unstaged additions and removals are green and red; staged ones share a quieter blue.
  ".sg-added-unstaged, .sg-edited-unstaged": {
    backgroundColor: "var(--sg-added)",
  },
  ".sg-added-staged, .sg-edited-staged": {
    backgroundColor: "var(--sg-staged)",
  },
  ".sg-inserted-unstaged": { backgroundColor: "var(--sg-added-text)" },
  ".sg-inserted-staged": { backgroundColor: "var(--sg-staged-text)" },
  ".sg-deleted": { textDecoration: "line-through" },
  ".sg-deleted-unstaged": { backgroundColor: "var(--sg-removed-text)" },
  ".sg-deleted-staged": {
    backgroundColor: "var(--sg-staged-text)",
    color: "var(--sg-muted)",
  },
  ".sg-removed-unstaged": { backgroundColor: "var(--sg-removed)" },
  ".sg-removed-staged": {
    backgroundColor: "var(--sg-staged)",
    color: "var(--sg-muted)",
  },
  ".sg-removed-row": { display: "flex" },
  ".sg-removed-row .sg-line": { flex: "1", minWidth: "0" },
  ".sg-removed-number": {
    flex: "none",
    boxSizing: "border-box",
    minWidth: "3em",
    paddingLeft: "var(--sg-pad)",
    textAlign: "right",
    color: "var(--sg-muted)",
    fontVariantNumeric: "tabular-nums lining-nums",
    userSelect: "none",
  },
  ".sg-removed-number::before": { content: '"−"' },
  ".sg-numbers .sg-gutter-unstaged, .sg-numbers .sg-gutter-staged, .sg-numbers .sg-gutter-removed-unstaged, .sg-numbers .sg-gutter-removed-staged":
    {
      backgroundSize: "3px 100%",
      backgroundPosition: "right top",
      backgroundRepeat: "no-repeat",
    },
  ".sg-numbers .sg-gutter-unstaged": {
    backgroundImage:
      "linear-gradient(var(--sg-added-bar), var(--sg-added-bar))",
  },
  ".sg-numbers .sg-gutter-removed-unstaged": {
    backgroundImage:
      "linear-gradient(var(--sg-removed-bar), var(--sg-removed-bar))",
  },
  ".sg-numbers .sg-gutter-staged, .sg-numbers .sg-gutter-removed-staged": {
    backgroundImage:
      "linear-gradient(var(--sg-staged-bar), var(--sg-staged-bar))",
  },
  ".cm-gutters.cm-gutters-after": { backgroundColor: "var(--sg-bg)" },
  ".sg-actions .cm-gutterElement": { padding: "0 0.6em 0 0.3em" },
  ".sg-action, .sg-action-spacer": {
    padding: "0.1em 0.5em",
    border: `1px solid ${rule}`,
    lineHeight: "1.3",
  },
  ".sg-action-spacer": { display: "inline-block" },
  ".sg-action:hover": { backgroundColor: "var(--sg-code-bg)" },
});

/** The component's fixed styles. Colours come from the palette that `paletteTheme` selects. */
export function baseTheme(): Extension {
  return styles;
}

/** Selects the light or dark palette. */
export function paletteTheme(palette: Palette): Extension {
  return [
    EditorView.editorAttributes.of({ class: `sg-${palette}` }),
    EditorView.darkTheme.of(palette === "dark"),
  ];
}
