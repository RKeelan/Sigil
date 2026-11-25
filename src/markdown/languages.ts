import type { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";

/**
 * Names that mean plain text. Some are also a language's file extension, as `text` is LaTeX's,
 * but a fence that gives one means its code isn't in a language.
 */
const plain = new Set(["text", "txt", "plain", "plaintext"]);

/**
 * The name of the language a fenced block's info string gives: its first word, in lower case.
 * Whatever follows, such as a title or `{1,3}` to pick out lines, is left off.
 */
export function fenceName(info: string): string {
  return (/^[^\s{]*/.exec(info.trim()) as RegExpExecArray)[0].toLowerCase();
}

/**
 * The language a fenced block's info string names, from CodeMirror's catalogue of languages, by
 * its name, an alias or a file extension. Its grammar is loaded when it is first needed, so the
 * description may not have it yet.
 */
export function fenceLanguage(info: string): LanguageDescription | null {
  const name = fenceName(info);
  if (!name || plain.has(name)) return null;
  return (
    languages.find((language) => language.alias.includes(name)) ??
    languages.find((language) =>
      language.extensions.some((extension) => extension.toLowerCase() === name),
    ) ??
    null
  );
}
