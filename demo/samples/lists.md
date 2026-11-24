# Lists

A list can directly follow a paragraph:
- first
- second
- third

Markers are kept as typed, because `*` and `-` can mean different things:

* A formal point, written as a sentence.
* Another, with a note under it.
    - an informal note
    - and another
        + a third level
        + with a second item
* Back at the top.

1. Numbered items keep the numbers they were given.
1. This one says 1 again, and is left that way.
7. And this one says 7.
   1. Nested numbers
   2. line up under the text of their parent.

10) A different delimiter starts a different list.
11) Wide markers push their text over a little.

## Tasks

- [ ] An open task
- [x] A finished one
- [ ] One with a nested list
  - [ ] nested open task
  - [x] nested finished task

## Long items

- A list item whose text is long enough to wrap onto a second row, and perhaps a third, so that the rows after the first can be seen to hang under the item's text and not under its marker.
  - A nested item that is just as long, to show that the hanging indent holds at every level of nesting and not only at the first, however narrow the window gets.

- An item with a second paragraph.

  The paragraph is indented to the item's text, and belongs to it.

  ```js
  // So does this code.
  const answer = 42;
  ```

- An item with a quote in it:
  > quoted, inside the item
  > on two lines

> 1. A list inside a quote
> 2. with two items
>    - and a nested one
