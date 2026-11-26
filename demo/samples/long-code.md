# Long code

Long fenced blocks, with prose and headings between them, to see how the colours hold up when most of the page is code.

## A Python module

```python
"""Counts words in a manuscript, chapter by chapter."""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

HEADING = re.compile(r"^(#{1,6})\s+(.*)$")
WORD = re.compile(r"[\w'’-]+")


@dataclass
class Chapter:
    title: str
    words: int = 0
    scenes: list[int] = field(default_factory=list)

    @property
    def is_long(self) -> bool:
        return self.words > 5_000


def chapters(text: str) -> list[Chapter]:
    """Splits the text at level-two headings, counting the words in each part."""
    found: list[Chapter] = [Chapter("Front matter")]
    for line in text.splitlines():
        match = HEADING.match(line)
        if match and len(match.group(1)) == 2:
            found.append(Chapter(match.group(2).strip()))
        elif line.strip() == "***":
            found[-1].scenes.append(0)
        else:
            count = len(WORD.findall(line))
            found[-1].words += count
            if found[-1].scenes:
                found[-1].scenes[-1] += count
    return [chapter for chapter in found if chapter.words]


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(f"usage: {argv[0]} MANUSCRIPT", file=sys.stderr)
        return 2
    text = Path(argv[1]).read_text(encoding="utf-8")
    for chapter in chapters(text):
        flag = "  (long)" if chapter.is_long else ""
        print(f"{chapter.words:>7,}  {chapter.title}{flag}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
```

## A TypeScript class

The editor's host might keep a cache of spell-check results, so that a paragraph is checked again only when it changes:

```ts
import type { Range } from "./types.ts";

interface Entry {
  text: string;
  misspelt: Range[];
  used: number;
}

/** Spell-check results for recently seen paragraphs, oldest dropped first. */
export class SpellingCache {
  private readonly entries = new Map<string, Entry>();
  private clock = 0;

  constructor(
    private readonly check: (text: string) => Promise<Range[]>,
    private readonly capacity = 500,
  ) {}

  async misspelt(text: string): Promise<Range[]> {
    const hit = this.entries.get(text);
    if (hit) {
      hit.used = ++this.clock;
      return hit.misspelt;
    }
    const misspelt = await this.check(text);
    this.entries.set(text, { text, misspelt, used: ++this.clock });
    if (this.entries.size > this.capacity) this.evict();
    return misspelt;
  }

  /** Forgets every result, as when a word is added to the dictionary. */
  clear(): void {
    this.entries.clear();
  }

  private evict(): void {
    const oldest = [...this.entries.values()].sort((a, b) => a.used - b.used);
    for (const entry of oldest.slice(0, this.entries.size - this.capacity)) {
      this.entries.delete(entry.text);
    }
  }
}
```

## A C ring buffer

```c
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#define RING_CAPACITY 256u /* Must be a power of two. */

typedef struct {
    uint8_t data[RING_CAPACITY];
    volatile size_t head; /* Written by the producer only. */
    volatile size_t tail; /* Written by the consumer only. */
} ring_t;

static inline size_t ring_used(const ring_t *ring)
{
    return (ring->head - ring->tail) & (RING_CAPACITY - 1u);
}

bool ring_put(ring_t *ring, uint8_t byte)
{
    if (ring_used(ring) == RING_CAPACITY - 1u) {
        return false; /* Full: one slot is always left empty. */
    }
    ring->data[ring->head] = byte;
    ring->head = (ring->head + 1u) & (RING_CAPACITY - 1u);
    return true;
}

size_t ring_take(ring_t *ring, uint8_t *out, size_t max)
{
    size_t taken = 0;
    while (taken < max && ring->tail != ring->head) {
        out[taken++] = ring->data[ring->tail];
        ring->tail = (ring->tail + 1u) & (RING_CAPACITY - 1u);
    }
    return taken;
}
```

## Rust, SQL and a shell script

```rust
use std::collections::HashMap;

/// The most frequent words in a text, most frequent first.
pub fn top_words(text: &str, n: usize) -> Vec<(String, usize)> {
    let mut counts: HashMap<String, usize> = HashMap::new();
    for word in text.split(|c: char| !c.is_alphanumeric() && c != '\'') {
        if word.len() > 3 {
            *counts.entry(word.to_lowercase()).or_default() += 1;
        }
    }
    let mut ranked: Vec<_> = counts.into_iter().collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    ranked.truncate(n);
    ranked
}
```

```sql
-- Chapters that grew by more than a tenth since the last draft.
SELECT c.title,
       d_old.words AS before,
       d_new.words AS after,
       ROUND(100.0 * (d_new.words - d_old.words) / d_old.words, 1) AS growth_pct
FROM chapters AS c
JOIN drafts AS d_new ON d_new.chapter_id = c.id AND d_new.version = c.latest_version
JOIN drafts AS d_old ON d_old.chapter_id = c.id AND d_old.version = c.latest_version - 1
WHERE d_new.words > d_old.words * 1.1
ORDER BY growth_pct DESC;
```

```sh
#!/usr/bin/env bash
set -euo pipefail

# Builds the manuscript into one file per format, stopping at the first failure.
out="${OUT:-build}"
mkdir -p "$out"
for format in epub docx pdf; do
  echo "Building $format…"
  pandoc chapters/*.md --metadata-file=meta.yaml --output="$out/manuscript.$format" --resource-path=.:images
done
echo "Done: $(ls "$out" | wc -l) files in $out"
```

## A long line

```json
{ "title": "A Long Manuscript", "author": "A. Writer", "chapters": 40, "words": 112480, "status": "second draft", "tags": ["fantasy", "novel", "draft"], "updated": "2026-11-26T13:15:00Z" }
```

The end.
