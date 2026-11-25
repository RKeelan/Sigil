import {
  DocInput,
  defineLanguageFacet,
  Language,
  languageDataProp,
  ParseContext,
} from "@codemirror/language";
import type { Text } from "@codemirror/state";
import type { NodeType, Parser, Tree } from "@lezer/common";
import {
  type BlockContext,
  parser as commonmark,
  GFM,
  type MarkdownConfig,
  parseCode,
} from "@lezer/markdown";
import { fenceLanguage, fenceName } from "./languages.ts";

const fenceLine = /^>>>[ \t]*$/;

/** The start of the innermost fenced quote open on the line being parsed, by parse. */
const innermostQuote = new WeakMap<BlockContext, number>();

/** The starts of the fenced quotes that have seen their closing fence, by parse. */
const closedQuotes = new WeakMap<BlockContext, Set<number>>();

/**
 * A quote opened and closed by `>>>` on a line of its own. Its content is parsed as blocks, so a
 * fenced quote can hold paragraphs, lists and code without a `>` on every line. A quote that is
 * never closed runs to the end of the document.
 */
const fencedQuote: MarkdownConfig = {
  defineNodes: [
    {
      name: "FencedQuote",
      block: true,
      composite(cx, _line, start) {
        if (closedQuotes.get(cx)?.has(start)) return false;
        innermostQuote.set(cx, start);
        return true;
      },
    },
    { name: "QuoteFence" },
  ],
  parseBlock: [
    {
      name: "FencedQuote",
      before: "Blockquote",
      parse(cx, line) {
        if (line.indent >= line.baseIndent + 4) return false;
        if (!fenceLine.test(line.text.slice(line.pos))) return false;
        const from = cx.lineStart + line.pos;
        if (cx.parentType().name === "FencedQuote") {
          let closed = closedQuotes.get(cx);
          if (!closed) {
            closed = new Set();
            closedQuotes.set(cx, closed);
          }
          closed.add(innermostQuote.get(cx) ?? -1);
          cx.addElement(cx.elt("QuoteFence", from, from + 3));
          cx.nextLine();
          return true;
        }
        cx.startComposite("FencedQuote", line.pos, from);
        cx.addElement(cx.elt("QuoteFence", from, from + 3));
        line.moveBase(line.text.length);
        return null;
      },
    },
  ],
};

const data = defineLanguageFacet({
  commentTokens: { block: { open: "<!--", close: "-->" } },
});

/** The grammars that `parseText` found it lacked, while it is parsing. */
let lacked: Promise<unknown>[] | null = null;

/**
 * The parser for a fenced block's code, when its info string names a known language. Its syntax
 * tree is mounted in the document's, over the block's code. A language's grammar is loaded the
 * first time a fence names it; until it arrives, the code is skipped, and the editor parses it
 * again once it has.
 */
function codeParser(info: string): Parser | null {
  const name = fenceName(info);
  if (name === "md" || name === "markdown") return fencedMarkdown;
  const language = fenceLanguage(info);
  if (!language) return null;
  if (language.support) return language.support.language.parser;
  const loading = language.load();
  lacked?.push(loading);
  return ParseContext.getSkippingParser(loading);
}

const fencedCode = parseCode({ codeParser });

/**
 * Markdown in a fenced block. It is a parser of its own so that its tree's top node differs
 * from the document's, which is how its highlighting is told apart from the document's syntax.
 */
const fencedMarkdown = commonmark.configure([GFM, fencedQuote, fencedCode]);

/**
 * The Markdown parser: CommonMark with GitHub's extensions and fenced quotes, and the code in
 * fenced blocks parsed in its own language.
 */
export const markdownParser = commonmark.configure([
  GFM,
  fencedQuote,
  fencedCode,
  { props: [languageDataProp.add({ Document: data })] },
]);

/** The type of the document's top node, as opposed to that of a tree mounted in it. */
export const documentType = markdownParser.nodeSet.types.find(
  (type) => type.isTop,
) as NodeType;

/** The CodeMirror language that keeps a syntax tree of the document. */
export const markdownLanguage = new Language(
  data,
  markdownParser,
  [],
  "markdown",
);

const trees = new WeakMap<Text, Tree>();
const loading = new WeakMap<Text, Promise<unknown>>();

/**
 * Parses a whole text, keeping the tree for as long as the text is alive. A fenced block whose
 * grammar hasn't loaded is left as plain code, and its grammar starts loading. Such a tree isn't
 * kept, so the text is parsed again the next time it is asked for.
 */
export function parseText(doc: Text): Tree {
  const kept = trees.get(doc);
  if (kept) return kept;
  const loads: Promise<unknown>[] = [];
  lacked = loads;
  let tree: Tree;
  try {
    tree = markdownParser.parse(new DocInput(doc));
  } finally {
    lacked = null;
  }
  if (loads.length) {
    const all = Promise.all(loads);
    // A grammar that fails to load is reported to whoever waits on it, if anyone does.
    all.catch(() => {});
    loading.set(doc, all);
  } else {
    trees.set(doc, tree);
    loading.delete(doc);
  }
  return tree;
}

/**
 * Loads the grammars a text's fenced blocks name, resolving to whether any had to be loaded.
 * Once it resolves, `parseText` parses the text in full.
 */
export async function loadGrammars(doc: Text): Promise<boolean> {
  parseText(doc);
  const pending = loading.get(doc);
  if (!pending) return false;
  await pending;
  return true;
}

/**
 * The end of the document's front matter: the end of the `---` or `...` line that closes a block
 * opened by `---` on the first line. Zero when the document has none, so an unclosed `---` at the
 * top stays a horizontal rule.
 */
export function frontMatterEnd(doc: Text): number {
  if (doc.lines < 2 || doc.line(1).text.trimEnd() !== "---") return 0;
  const limit = Math.min(doc.lines, 500);
  for (let n = 2; n <= limit; n++) {
    const line = doc.line(n);
    if (/^(---|\.\.\.)[ \t]*$/.test(line.text)) return line.to;
  }
  return 0;
}
