import { cppLanguage } from "@codemirror/lang-cpp";
import { cssLanguage } from "@codemirror/lang-css";
import { goLanguage } from "@codemirror/lang-go";
import { htmlLanguage } from "@codemirror/lang-html";
import { javaLanguage } from "@codemirror/lang-java";
import {
  javascriptLanguage,
  jsxLanguage,
  tsxLanguage,
  typescriptLanguage,
} from "@codemirror/lang-javascript";
import { jsonLanguage } from "@codemirror/lang-json";
import { pythonLanguage } from "@codemirror/lang-python";
import { rustLanguage } from "@codemirror/lang-rust";
import { StandardSQL } from "@codemirror/lang-sql";
import { xmlLanguage } from "@codemirror/lang-xml";
import { yamlLanguage } from "@codemirror/lang-yaml";
import { type Language, StreamLanguage } from "@codemirror/language";
import { csharp } from "@codemirror/legacy-modes/mode/clike";
import { diff } from "@codemirror/legacy-modes/mode/diff";
import { powerShell } from "@codemirror/legacy-modes/mode/powershell";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { toml } from "@codemirror/legacy-modes/mode/toml";

/**
 * The languages whose code is highlighted in a fenced block, with the names a fence can give
 * each. They are bundled rather than loaded when a fence names one, so that a host serves no
 * script but the component's own. Markdown, the other language highlighted, is set up in
 * `parser.ts`.
 */
const languages: [Language, string[]][] = [
  [cppLanguage, ["c", "h", "cpp", "c++", "cc", "cxx", "hpp", "hxx"]],
  [StreamLanguage.define(csharp), ["cs", "csharp", "c#"]],
  [cssLanguage, ["css"]],
  [StreamLanguage.define(diff), ["diff", "patch"]],
  [goLanguage, ["go", "golang"]],
  [htmlLanguage, ["html", "htm", "xhtml"]],
  [javaLanguage, ["java"]],
  [javascriptLanguage, ["js", "javascript", "mjs", "cjs"]],
  [jsonLanguage, ["json"]],
  [jsxLanguage, ["jsx"]],
  [StreamLanguage.define(powerShell), ["ps1", "powershell", "pwsh"]],
  [pythonLanguage, ["py", "python", "python3"]],
  [rustLanguage, ["rs", "rust"]],
  [StreamLanguage.define(shell), ["sh", "bash", "shell", "zsh"]],
  [StandardSQL.language, ["sql"]],
  [StreamLanguage.define(toml), ["toml"]],
  [tsxLanguage, ["tsx"]],
  [typescriptLanguage, ["ts", "typescript", "mts", "cts"]],
  [xmlLanguage, ["xml", "svg", "xsd", "xsl", "xslt"]],
  [yamlLanguage, ["yaml", "yml"]],
];

const byName = new Map(
  languages.flatMap(([language, names]) =>
    names.map((name) => [name, language] as const),
  ),
);

/**
 * The name of the language a fenced block's info string gives: its first word, in lower case.
 * Whatever follows, such as a title or `{1,3}` to pick out lines, is left off.
 */
export function fenceName(info: string): string {
  return (/^[^\s{]*/.exec(info.trim()) as RegExpExecArray)[0].toLowerCase();
}

/** The language a fenced block's info string names, if it is one that is highlighted. */
export function fenceLanguage(info: string): Language | null {
  return byName.get(fenceName(info)) ?? null;
}
