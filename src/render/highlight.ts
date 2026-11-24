import { tags as t, tagHighlighter } from "@lezer/highlight";
import { documentType } from "../markdown/parser.ts";

/**
 * Gives each token of a fenced block's code a class for its role, which the theme colours. The
 * document's own Markdown is left alone, because the editor renders it rather than colouring it;
 * Markdown inside a fenced block is code like any other.
 */
export const codeHighlighter = tagHighlighter(
  [
    { tag: t.comment, class: "sg-tok-comment" },
    {
      tag: [
        t.keyword,
        t.meta,
        t.annotation,
        t.processingInstruction,
        t.documentMeta,
      ],
      class: "sg-tok-keyword",
    },
    {
      tag: [t.number, t.bool, t.null, t.atom, t.unit, t.escape, t.color],
      class: "sg-tok-literal",
    },
    {
      tag: [t.string, t.regexp, t.special(t.string), t.monospace],
      class: "sg-tok-string",
    },
    {
      tag: [
        t.function(t.variableName),
        t.function(t.propertyName),
        t.standard(t.variableName),
        t.macroName,
      ],
      class: "sg-tok-function",
    },
    { tag: [t.typeName, t.className, t.namespace], class: "sg-tok-type" },
    { tag: t.propertyName, class: "sg-tok-property" },
    { tag: t.inserted, class: "sg-tok-inserted" },
    { tag: t.deleted, class: "sg-tok-deleted" },
    { tag: t.heading, class: "sg-tok-heading" },
    { tag: t.emphasis, class: "sg-tok-em" },
    { tag: t.strong, class: "sg-tok-strong" },
    { tag: [t.link, t.url], class: "sg-tok-link" },
  ],
  { scope: (top) => top !== documentType },
);
