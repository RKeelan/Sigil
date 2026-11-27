# Sigil design

Sigil is a Markdown editor component that works the way Typora and Obsidian's live preview do: one pane, formatting rendered in place, and the raw syntax shown only where the cursor is. It is for reading, reviewing and editing Markdown.

It is built on CodeMirror 6, whose decorations can hide syntax, size headings, and replace tables and images with rendered widgets. CodeMirror edits text rather than a document model, so the file contains exactly what was typed.

The component knows nothing about its host. Its first host is a VS Code extension, as a custom text editor; others, such as a desktop app built with Tauri, implement the same interface.

## Requirements

* Render Markdown in place in a single pane, revealing the syntax at the cursor (see Appearance).
* Never reformat text the user didn't edit. List markers (`*` and `-` mean different things to some authors), table alignment, line breaks and blank lines survive a save byte for byte.
* Handle CommonMark and GitHub-flavoured Markdown, including a list that directly follows a paragraph, and fenced quotes opened and closed by `>>>` on a line of its own.
* Spell-check through the host, and add words through it, so that a host can use the dictionaries the user already has.
* Offer a theme setting of Light, Dark or System, where System follows the host.
* Show unstaged changes in the rendered view, and stage them there, a change at a time.

## Line numbers

* Line numbers are on by default, in rendered Markdown as much as in source, with a setting that turns them off.
* They number source lines. A wrapped line is numbered once, on its first row.
* Each number is centred vertically on its line's first row, so that a heading's number is centred on the heading and an image's on the image. A wrapped line's number stays beside the text it starts with, rather than in the middle of the paragraph. The row's height is whatever the page lays out, so the gutter measures it from the drawn text, images and rules of the row, and moves the number to its middle.
* Every source line keeps its number, which constrains rendering: a widget must not collapse several source lines into one numbered row. A table is drawn a row per source line, its delimiter row included, and front matter, if hidden, is hidden behind a fold that shows its range. CodeMirror's line-number gutter numbers one block per replaced range, so multi-line widgets need a gutter of the component's own. A line of syntax that is hidden (see Appearance) has no row, and its number is left out, so that the gap in the numbering shows where it is.
* The numbers are right-aligned, in the document's font and size, with tabular figures. While the editor has focus, the cursor's line number is in the text's colour and the others are muted.
* The gutter is at least three digits wide, widens when a line needs another digit, and never narrows when lines are deleted.
* A margin rule, two 1 px lines 2 px apart, runs the full height of the view beside the numbers and does not scroll with the text.

## Typography

* Markdown is set in a proportional serif, Source Serif 4, with code spans and fences in IBM Plex Mono at 0.9 of the text's size, so the two look the same size. Both are under the SIL Open Font License.
* Text is set in a column 90 characters wide by default, the upper end of the 45 to 90 characters that Butterick's *Practical Typography* recommends. Bringhurst's *The Elements of Typographic Style* sets a narrower range, 45 to 75, with 66 as ideal. A measure setting changes the width, or turns the column off so that text wraps at the width of the view. The setting counts characters of English prose, spaces included, which in Source Serif 4 average 0.48 of the font's size. CSS's `ch` unit is the width of a zero, which is wider than that, so the component works the width out in `em` instead.
* The column, with the gutters beside it, is centred in the view, and the scroller still fills the view, so its scroll bar stays at the view's edge. Code blocks, tables and images keep to the column.
* Tab stops are four spaces apart.

## Keys

* Enter continues a list item or quote: the same bullet, the next number, an open task, with the item's indentation and `>` marks. Enter on an empty item outdents it, or removes its marker if it isn't indented. Items are never renumbered.
* Tab right after a list item's marker nests the item under its previous sibling, at that sibling's content column; Shift+Tab outdents it. A selection across lines nests or outdents every item in it. Elsewhere, Tab types a tab.
* Open line (Ctrl+Shift+Enter) breaks the line at the cursor and leaves the cursor before the break, as Emacs's C-o does.
* Undo groups typing by word and the whitespace after it, not by time, and puts the cursor back where it was before the step.
* Snippets: a trigger typed before the cursor offers a snippet's text in its place. A snippet can mark where the cursor goes and where today's date goes, and can be limited to the start of a line.
* Other editing keys come from CodeMirror's default keymap, which follows VS Code's for most of them, such as Alt+Up to move a line and Ctrl+D to select the next occurrence.

## Appearance

* Nothing animates. Nothing on screen moves as state changes, except where live preview reveals syntax at the cursor, which it can't avoid.
* A reveal scope setting says how much syntax the cursor reveals: the syntax on every source line the selection touches (line scope, the default), or only the syntax of the constructs the selection touches (construct scope; see Revealing constructs). Line scope is the steadier of the two. A source line is usually a paragraph or a list item, so moving the cursor within one never moves text, and moving between them shifts only the line left and the line entered. Construct scope shows less raw source, but moves text each time the cursor enters or leaves a construct, which is worse while typing. In either scope, a table, fenced block or setext heading is revealed whole.
* A line that holds nothing but syntax takes up no room while its construct's source isn't shown: a fenced block's closing fence, its opening fence when that names no language, a setext heading's underline, and a fenced quote's `>>>` lines. The opening fence of a block that names a language keeps its row, which shows the language and is where it is edited; an empty block keeps its opening fence too, so that it still has a row. A fenced quote's opening `>>>` can carry nothing else, so it is hidden like a fence that names no language, but is kept when the quote is empty, and when the quote is never closed, since the quote then runs to the end of the document and the fence is what says so. Each of a fenced quote's `>>>` lines is a construct of its own, in either scope, rather than part of the quote, because a quote can run for pages and entering it shouldn't move lines far from the cursor. Such a line comes back when the cursor or a selection enters its construct, or while a change on or next to it is waiting to be reviewed. Up and Down stop on a hidden line rather than pass it: the cursor moves onto the line, which shows it, so the text moves as the cursor arrives rather than after, and the next Up or Down goes on into the construct. The cursor lands at the end of the line's syntax coming from below and at its start coming from above, and keeps the column it had, so that a run of Up or Down presses comes back to that column on the far side. An edit made from outside the construct that would change a hidden line, join another line to it or move a line past it, as Backspace at the start of the line below a closing fence would, isn't made; the cursor moves onto the line instead, to the same place Up or Down would put it, which shows it, and the same key then acts in view.
* Headings are larger than the text, and keep their size whether or not the cursor is on them. A row's height changes only when a line becomes or stops being a heading.
* The component has light and dark palettes of its own, and never takes its colours from the host.
* A selection shows the same over code and changes as over plain text. CodeMirror draws the selection in a layer behind the text, where the backgrounds of the text's own elements would hide it, so the backgrounds of code blocks, code spans and changes are drawn in a layer of their own below the selection's.
* Code in a fenced block is highlighted in the language its info string names, if CodeMirror's catalogue of languages has it. A language's grammar is loaded the first time a fence names it, so that a document pays only for the languages it uses; until it arrives, the block is shown uncoloured. Markdown in a fenced block is highlighted as code, not rendered.

## Revealing constructs

In construct scope, each piece of syntax belongs to one construct, and is shown as typed while the selection touches that construct. A selection touches a construct when the two overlap or meet, so a cursor just before a construct's first character or just after its last touches it, which lets the user step into a construct's marks from either side and delete them.

* An emphasis, strong emphasis, strikethrough or code span mark belongs to the span it opens or closes, from the opening mark to the closing one. Spans nest, and the cursor reveals every span around it but none beside it: in `**a *b* c**`, a cursor in `c` shows the `**` marks and hides the `*` marks, and a cursor in `b` shows both.
* A link's brackets, destination and title belong to the whole link, from `[` to the closing `)` or `]`. An image's source belongs to the whole image, and an autolink's angle brackets to the whole autolink.
* A backslash escape is a construct of its own: the backslash and the character it escapes.
* An ATX heading's `#` marks, opening and closing, belong to the whole heading, so the cursor anywhere in a heading shows them. Syntax inside a heading, such as emphasis, belongs to its own construct as usual.
* A list item's marker, with the space after it, is a construct of its own, and so is a task's box (`[ ]`), each `>` of a quote with the space after it, a fenced quote's `>>>` line and a thematic break. The cursor anywhere else in a list item or quote leaves its marks rendered. These marks sit in boxes of fixed width, so showing them changes a glyph but never moves text.
* A table or a fenced block is one construct: the cursor anywhere in it shows all of its source.
* A setext heading's underline, while it isn't hidden (see Appearance), a link reference definition, a hard break's backslash and HTML are always shown as typed, in either scope.

Plain text has no syntax, so a cursor in a plain word reveals nothing.

## Host interface

The host supplies everything outside the editor:

* Document sync: the host sends the initial text and outside changes, and the component reports each edit.
* Spell-checking: the host is given text and returns misspelled ranges, and is told when the user adds a word.
* Theme: the host says whether it is light or dark, which System follows. A host that says nothing leaves System to the page's `prefers-color-scheme`.
* Changes: the host supplies the index text, and is given the new index text when the user stages a change. Unstaging is the host's to offer; it supplies the new index text afterwards.

## Changes and staging

Staging can mark changes as reviewed: changes someone else made, such as a coding agent, are read, and each is staged once it has been checked. Doing that in the rendered view means reviewing prose as it reads rather than as source.

* The host gives the component the file as it is in the index. The component compares the document with it and shows the differences inline, rendered like the rest of the text: added text marked in the gutter and on its background, and removed text shown as a rendered widget where it was. CodeMirror's merge package (`@codemirror/merge`) has an inline mode, `unifiedMergeView`, that does this for one base, and is the place to start.
* A line that keeps most of its text is shown as an edit to it, as VS Code shows one: the words taken out struck through where they were, and the words put in marked. Within a change, each line taken out is paired with a line put in that keeps most of its text, so a line edited beside lines put in or taken out is still shown as an edit. Pairs keep their order on both sides and are chosen to keep the most text; the lines left over are shown as lines taken out and lines put in. A paragraph is one long line, so pairing is kept cheap: lines that share few runs of three characters aren't compared character by character, and the comparisons within a change stop once they have covered one and a half times its text. An edit inside a table row is shown as the old row above the new, since a table is drawn as a whole.
* Each change between the index and the document is unstaged, and has Stage. A staged change is in the index, so it isn't a change from the index: it looks like the rest of the text, with no background, gutter bar or button, and lines it removed aren't shown. This is how VS Code's diff view of the working tree shows a file, and it leaves in view only what is still to be reviewed.
* Unstaging belongs to the host, as it does in VS Code, whose Source Control view unstages a file and whose diff of the index against `HEAD` unstages a range. After unstaging, the host supplies the new index text, and the unstaged changes reappear.
* Removed lines have no number in the document. Their widget shows the lines' numbers from the index, set apart from the document's own.
* Stage is worked out as text: the component computes what the index should hold, the index text with that one change applied, and gives it to the host. A host using the `git` CLI writes it with `git hash-object -w --stdin` and `git update-index --cacheinfo`, which avoids building a patch for `git apply --cached`.
* The changes are worked out in whole when the host gives the index, which for a book-length document with every paragraph changed takes most of a second. After that they are kept, and an edit works them out again only where it fell, together with the changes it touches, while the changes after it move with the lines it put in or took out. Staging a change drops it and moves the ones after it in the index. So typing costs the same however many changes the document has.
* Showing changes is a mode that can be turned off, leaving the plain rendered view.

## Demo page

The repository holds a demo page: a plain web page that hosts the component in a browser, with a host of its own.

* It loads sample documents chosen to exercise the hard cases: tables, nested lists, fences, front matter, long lines and a long manuscript.
* Its spell-checker is a stub with a fixed word list.
* Its Line length control offers measures from 45 to 90 characters, and the full width of the view.
* It holds the index in memory, and has an Unstage all button that puts `HEAD`'s text back in the index, standing in for a host's own way of unstaging.
* Its host never says whether it is light or dark, so the System theme follows the browser's `prefers-color-scheme`. The page's own colours are the editor's, and follow the same setting.
* It exposes the editor and the document's text on `window`, so a test, or an agent driving a browser, can type into the page and then check the source text byte for byte.
* It applies the same content security policy as a VS Code webview, so code that would fail in VS Code fails here first.
* It is a static site, published to GitHub Pages. Each language's grammar is a file of its own, fetched when a fence first names the language, as a VS Code extension's would be. Locally, a script serves the site and builds it again as the source changes.

The same page is what Playwright drives in CI.

## The VS Code host

The VS Code extension is a thin wrapper: a `CustomTextEditorProvider` that shows the component in a webview, applies its edits to the `TextDocument` as `WorkspaceEdit`s, runs spell-checking and Git, and reports the theme. VS Code keeps owning the document, so save, undo and Git behave normally.

* Editor extensions, such as Code Spell Checker, don't apply inside the webview, so the extension provides spell-checking.
* Keys reach the page first. VS Code's webviews pass on the keys a page doesn't handle, so workbench shortcuts (the command palette, Quick Open, the terminal, switching tabs, saving) keep working. Shortcuts bound to VS Code's text editor don't, and the component's keymap provides them instead. Shortcuts the user has customised in VS Code don't carry over, because VS Code has no API that exposes them.
* VS Code owns the document's undo stack, and CodeMirror has its own; one of them has to defer to the other.
* Since VS Code 1.129, a custom editor registered with `"priority": "default"` stays out of diff and merge views unless it opts in ([issue #324791](https://github.com/microsoft/vscode/issues/324791)). The extension requires 1.129 or later and doesn't opt in, so VS Code's own diff view, merge editor and text editor stay available for Markdown files.
* VS Code's Git extension has no public API for staging part of a file, so the extension runs `git` itself. It watches `.git/index` and `HEAD` so that staging done elsewhere reaches the view.
* Spell-checking runs `cspell-lib`, the engine Code Spell Checker is built on, in the extension host. It reads `cspell.json` files itself, and the extension passes in VS Code's `cSpell.*` settings (`cSpell.language`, `cSpell.import`, `cSpell.customDictionaries` with `${workspaceFolder}` resolved, `cSpell.userWords`) as overrides. "Add to dictionary" writes where Code Spell Checker would, so a word added in either editor is known to both.
* The webview's content security policy allows scripts from the extension's own files (`webview.cspSource`), so that a language's grammar can be loaded when a fence first names it.
* The extension reports VS Code's theme as light or dark, from the `vscode-light` and `vscode-dark` classes on the webview's body, so System follows VS Code, which can itself follow the operating system.

## Open questions

* Whether `cspell-lib`, used directly, resolves URL imports the way Code Spell Checker does.
* Whether Code Spell Checker exposes an API another extension can call, which would avoid bundling a second copy of the engine.
* Which undo stack wins, and how to keep the other consistent with it.
* How the component renders tables, images and code blocks, and what editing a table looks like.
* Performance on long documents, such as a novel manuscript in one file.
* Whether staging a change in a document with unsaved edits stages the edited text, as VS Code's own staging of selected ranges does, or requires a save first.
* How a change inside a table or a fenced block is shown, since those render as a whole.
