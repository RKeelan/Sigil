# Sigil

[![CI](https://github.com/RKeelan/Sigil/actions/workflows/ci.yml/badge.svg)](https://github.com/RKeelan/Sigil/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A live-preview Markdown editor component built on CodeMirror 6: one pane, formatting rendered in place, and the raw syntax shown only on the line the cursor is on, or, with the `reveal` setting at `"construct"`, only in the construct the cursor touches. [`docs/design.md`](docs/design.md) says what it does and why, and the [demo site](https://rkeelan.github.io/Sigil/) lets you try it in a browser.

## Using it

The component knows nothing about the page it is on. A host creates an editor in an element and supplies whatever the editor needs from outside itself:

```ts
import "sigil/fonts.css";
import { Sigil } from "sigil";

const editor = new Sigil({
  parent: document.querySelector("#editor"),
  text: "# Hello\n",
  host: {
    // Each edit, as replacements in the text as it was before the edit.
    edit(changes) {},
    // The misspelled ranges within a piece of text.
    async checkSpelling(text) {
      return [];
    },
    addWord(word) {},
    // The index's new text, when a change is staged.
    setIndex(text) {},
  },
  settings: {
    theme: "system",
    lineNumbers: true,
    reveal: "line", // or "construct"
    showChanges: true,
  },
});

editor.setText(text); // the document changed outside the editor
editor.setChanges({ index }); // the index text to show unstaged changes against
editor.setHostTheme("dark"); // what the System theme follows
```

Every member of `host` is optional, and a host that leaves one out goes without what it provides. The editor shows the changes between the index and the document, each with a Stage button. A staged change is in the index, so it looks like the rest of the text, as in VS Code's diff view; unstaging is left to the host, which calls `setChanges` with the new index afterwards. `sigil/fonts.css` loads the fonts the editor is set in, Source Serif 4 and IBM Plex Mono; the editor's size is the font size of the element it is put in.

## Demo page

`bun run demo` serves the demo site at http://localhost:5850: a page that hosts the editor in a browser with a host of its own, with sample documents, a stub spell-checker and an index held in memory. It builds the site again whenever the source changes. `bun run build:demo` writes the same site to `dist/demo`, which is what GitHub Pages publishes at https://rkeelan.github.io/Sigil/. The page runs under the content security policy of a VS Code webview, and fetches the grammar for a fenced block's language when a fence first names it.

The page puts its editor on `window.sigil`, along with the document's text and what its host has been told, so that a test or an agent driving a browser can type into it and check the result. `demo/api.ts` lists what is there. The end-to-end tests in `e2e` drive this page with Playwright.

## Commands

```sh
bun install          # install dependencies
bun run lint         # lint with Biome
bun run lint:pkg     # check that package.json pins every dependency
bun fmt              # format; bun fmt --check checks without writing
bun check            # type check
bun test             # run the unit tests, with coverage
bun run demo         # serve the demo site, building it again as the source changes
bun run build:demo   # build the demo site into dist/demo
bun run test:e2e     # run the end-to-end tests against the demo site
```

The end-to-end tests need Playwright's browser, which `bunx playwright install chromium` installs.

## Releasing

Sigil is released as Git tags, which a host depends on as `github:RKeelan/Sigil#vX.Y.Z`. To release a version:

- Set the version in `package.json` and the `version` constant in `src/index.ts`, and merge the change.
- Tag the merged commit on `main` as `vX.Y.Z` and push the tag.

Pushing the tag runs the release workflow, which checks that the tag matches `package.json`, runs the same checks as CI, and creates a GitHub Release with generated notes.
