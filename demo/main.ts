import "../src/fonts.css";
import "./style.css";
import {
  type Host,
  type Settings,
  Sigil,
  type TextChange,
} from "../src/index.ts";
import type {} from "./api.ts";
import { type Sample, samples } from "./samples.ts";

const violations: string[] = [];
document.addEventListener("securitypolicyviolation", (event) => {
  violations.push(`${event.violatedDirective} ${event.blockedURI}`);
});

/** The stub spell-checker's whole vocabulary: the words it calls misspelled. */
const misspelled = [
  "teh",
  "recieve",
  "seperate",
  "occured",
  "definately",
  "wich",
  "adress",
  "untill",
];
const words: string[] = [];

function control<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const parent = control<HTMLElement>("editor");
const sampleSelect = control<HTMLSelectElement>("sample");
const themeGroup = control<HTMLFieldSetElement>("theme");
const numbers = control<HTMLInputElement>("numbers");
const changes = control<HTMLInputElement>("changes");
const nonce = document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce;

for (const sample of samples) {
  const option = document.createElement("option");
  option.value = sample.name;
  option.textContent = sample.title;
  sampleSelect.append(option);
}

let editor: Sigil;
let index = "";
let head = "";
let edits: TextChange[][] = [];

// The demo's host: the things a real host would do with a file system, Git and a dictionary,
// done in memory. It never calls `setHostTheme`, since a web page has no theme of its own, so the
// System theme follows the browser's `prefers-color-scheme`.
const host: Host = {
  edit(changed) {
    edits.push([...changed]);
  },
  async checkSpelling(text) {
    const found = [];
    for (const match of text.matchAll(/[A-Za-z']+/g)) {
      const word = match[0].toLowerCase();
      if (misspelled.includes(word) && !words.includes(word))
        found.push({ from: match.index, to: match.index + match[0].length });
    }
    return found;
  },
  addWord(word) {
    words.push(word.toLowerCase());
  },
  setIndex(text) {
    index = text;
  },
};

function theme(): Settings["theme"] {
  const chosen = themeGroup.querySelector<HTMLInputElement>("input:checked");
  return (chosen?.value ?? "system") as Settings["theme"];
}

/** Sets the page's own colours to the theme the editor is given. */
function paint() {
  const value = theme();
  if (value === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = value;
}

function settings(): Settings {
  return {
    theme: theme(),
    lineNumbers: numbers.checked,
    showChanges: changes.checked,
    snippets: [
      { trigger: ";date", text: "{{date}}" },
      { trigger: "todo", text: "- [ ] {{cursor}}", lineStart: true },
      { trigger: ";sig", text: "Regards,\n{{cursor}}\n" },
    ],
  };
}

function load(name: string) {
  const sample: Sample | undefined =
    samples.find((s) => s.name === name) ?? samples[0];
  if (!sample) return;
  editor?.destroy();
  edits = [];
  head = sample.head ?? sample.text;
  index = sample.index ?? sample.text;
  editor = new Sigil({
    parent,
    text: sample.text,
    host,
    settings: settings(),
    nonce,
  });
  editor.setChanges({ index, head });
  sampleSelect.value = sample.name;
  if (location.hash.slice(1) !== sample.name)
    history.replaceState(null, "", `#${sample.name}`);
  editor.focus();
}

sampleSelect.addEventListener("change", () => load(sampleSelect.value));
themeGroup.addEventListener("change", () => {
  paint();
  editor.setSettings(settings());
});
numbers.addEventListener("change", () => editor.setSettings(settings()));
changes.addEventListener("change", () => editor.setSettings(settings()));
window.addEventListener("hashchange", () => load(location.hash.slice(1)));

load(location.hash.slice(1));

window.sigil = {
  get editor() {
    return editor;
  },
  get text() {
    return editor.text;
  },
  get index() {
    return index;
  },
  get head() {
    return head;
  },
  get edits() {
    return edits;
  },
  words,
  violations,
  load,
};
