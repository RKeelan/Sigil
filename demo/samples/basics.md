# Sigil

Sigil is a *live-preview* Markdown editor: one pane, formatting rendered **in place**, and the raw syntax shown only on the line the cursor is on. Click a line to see how it was typed.

## Inline formatting

Text can be *emphasised*, **strong**, ***both***, ~~struck through~~, or set as `code`. A link looks like [CodeMirror](https://codemirror.net/ "The editor Sigil is built on"), a bare address like https://example.com is linked too, and so is <https://example.org>. A bracketed phrase [sic] that isn't a link is left alone.

Escapes work: \*not emphasis\*, and so do entities: &copy; &amp; &mdash;.

A line that ends with two spaces  
breaks without ending the paragraph, as does one that ends with a backslash\
like this.

### Headings keep their size

#### Fourth level

##### Fifth level

###### Sixth level

Setext headings
===============

An older way to write a heading
-------------------------------

## Quotes

> A quote can run over several lines,
> and hold **formatting**.
>
> > Quotes nest.
>
> - A list in a quote
> - With two items

>>>
A fenced quote opens and closes with three angle brackets on a line of their own.

It can hold several paragraphs without a mark on every line:

- and lists
- as well
>>>

## Rules and pictures

---

![A small diagram](data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNDAiIGhlaWdodD0iODAiIHZpZXdCb3g9IjAgMCAyNDAgODAiPjxyZWN0IHdpZHRoPSIyNDAiIGhlaWdodD0iODAiIGZpbGw9IiNlOGUzZDgiLz48Y2lyY2xlIGN4PSI0MCIgY3k9IjQwIiByPSIyMiIgZmlsbD0iIzFjNWE5ZSIvPjxyZWN0IHg9IjkwIiB5PSIxOCIgd2lkdGg9IjQ0IiBoZWlnaHQ9IjQ0IiBmaWxsPSIjM2E5ZDQ2Ii8+PHBhdGggZD0iTTE4MCA2MiBMMjAyIDE4IEwyMjQgNjIgWiIgZmlsbD0iI2NmNDMzOCIvPjwvc3ZnPg==)

## Code

A fenced block's code is highlighted in the language its first line names.

```powershell
# Count the Markdown files under a folder
$files = Get-ChildItem -Path . -Filter *.md -Recurse
Write-Host "Found $($files.Count) files"
```

```bash
# Count the words in every chapter
for file in chapters/*.md; do
  echo "$file: $(wc -w < "$file") words"
done
```

```python
from dataclasses import dataclass

@dataclass
class Chapter:
    title: str
    words: int = 0

    def is_long(self) -> bool:
        return self.words > 5_000  # a rough limit
```

```rust
/// Counts the words in a piece of text.
fn word_count(text: &str) -> usize {
    text.split_whitespace().count()
}

fn main() {
    let n = word_count("one two three");
    println!("{n} words");
}
```

```cpp
#include <string>
#include <vector>

// The total length of a list of lines.
std::size_t total(const std::vector<std::string>& lines) {
    std::size_t sum = 0;
    for (const auto& line : lines) sum += line.size();
    return sum;
}
```

## Spelling

The demo's spell-checker knows a short list of misspellings, such as teh and recieve. Right-click one to add it to the dictionary. Misspellings in `teh code` and in addresses like https://example.com/teh are left alone.

Some <span>inline HTML</span> and a comment <!-- like this --> are shown as written.

<div align="center">
  An HTML block is shown as written too.
</div>

[CodeMirror]: https://codemirror.net/
