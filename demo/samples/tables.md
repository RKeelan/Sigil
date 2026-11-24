# Tables

A table is drawn a row per source line, its delimiter row included. Click in it to see the source.

| Key          | Action                               | Notes                     |
|--------------|--------------------------------------|---------------------------|
| Enter        | Continue a list item or quote        | An empty item is outdented |
| Tab          | Nest an item under the one above     | Elsewhere, types a tab    |
| Shift+Tab    | Outdent an item                      |                           |
| Ctrl+Shift+Enter | Open a line                      | Like `C-o` in Emacs       |

## Alignment

| Left | Centre | Right |
|:-----|:------:|------:|
| a    |   b    |     1 |
| aa   |   bb   |    22 |
| aaa  |  bbb   |   333 |

## Formatting in cells

| Syntax | Result | Link |
|---|---|---|
| `*text*` | *text* | [emphasis](https://commonmark.org/help/) |
| `**text**` | **text** | [strong](https://commonmark.org/help/) |
| `~~text~~` | ~~text~~ | [strikethrough](https://github.github.com/gfm/) |

## A wide table

| Setting | Description | Default |
|---|---|---|
| theme | Whether the editor is light, dark, or follows the host. A host that says nothing leaves it to the page's own colour scheme. | system |
| lineNumbers | Whether source lines are numbered in the gutter. A wrapped line is numbered once, on its first row. | true |
| showChanges | Whether uncommitted changes are shown in the text, with buttons to stage and unstage them one at a time. | true |

No leading or trailing pipes:

Name | Role
--- | ---
Ada | Engineer
Grace | Admiral

- A table in a list item:

  | a | b |
  |---|---|
  | 1 | 2 |
