export {
  type ChangeBases,
  defaultSettings,
  type Host,
  type Options,
  type Settings,
  Sigil,
  type TextChange,
} from "./editor.ts";
export type { RevealScope } from "./render/preview.ts";
export type { Snippet } from "./snippets.ts";
export type { Misspelling } from "./spell.ts";
export { mono, type Palette, serif } from "./theme.ts";

/** The version of Sigil, kept in step with package.json. */
export const version = "0.2.0";
