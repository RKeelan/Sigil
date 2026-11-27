import { type Extension, Prec } from "@codemirror/state";
import { type EditorView, layer, RectangleMarker } from "@codemirror/view";

/**
 * The elements whose backgrounds are drawn in the layer, and the class each one's rectangles
 * get. An element takes the first rule it matches, so a change's colour wins over a code block's
 * on a line that is both.
 */
const rules: readonly [selector: string, cls: string][] = [
  [".sg-added, .sg-edited", "sg-bg-added"],
  [".sg-removed", "sg-bg-removed"],
  [".sg-inserted", "sg-bg-added-text"],
  [".sg-deleted", "sg-bg-removed-text"],
  [".sg-code-line", "sg-bg-code"],
  [".sg-code", "sg-bg-code sg-bg-code-span"],
];

const all = rules.map(([selector]) => selector).join(", ");

/** The rectangles of the backgrounds drawn in the layer, placed relative to the scroller. */
export function markers(view: EditorView): RectangleMarker[] {
  const { scaleX, scaleY, scrollDOM } = view;
  const scroller = scrollDOM.getBoundingClientRect();
  const left = scroller.left - scrollDOM.scrollLeft * scaleX;
  const top = scroller.top - scrollDOM.scrollTop * scaleY;
  const out: RectangleMarker[] = [];
  // Elements come in document order, so one inside another, such as an inserted word in an
  // edited line, is drawn over it.
  for (const element of view.contentDOM.querySelectorAll(all)) {
    const cls = rules.find(([selector]) => element.matches(selector))?.[1];
    if (!cls) continue;
    // An inline element that wraps has a rectangle for each row it is on.
    for (const rect of element.getClientRects()) {
      out.push(
        new RectangleMarker(
          `sg-bg ${cls}`,
          (rect.left - left) / scaleX,
          (rect.top - top) / scaleY,
          rect.width / scaleX,
          rect.height / scaleY,
        ),
      );
    }
  }
  return out;
}

/**
 * Draws the backgrounds of code blocks, code spans and changes in a layer below the selection's.
 * As backgrounds of the text's own elements, they would be painted over the selection, which is
 * drawn behind the text, and hide it.
 */
export function backgrounds(): Extension {
  // A layer below the text is stacked under the layers below the text that come before it, so
  // this one, at the lowest precedence, is under the selection.
  return Prec.lowest(
    layer({
      above: false,
      class: "sg-backgrounds",
      markers,
      // The layer is measured again whenever the editor's DOM or geometry changes, which is
      // whenever anything it draws can have changed.
      update: () => false,
    }),
  );
}
