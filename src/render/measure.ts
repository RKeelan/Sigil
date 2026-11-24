import type { EditorView } from "@codemirror/view";
import { mono } from "../theme.ts";
import type { Measure, TextStyle } from "./pieces.ts";

/**
 * Measures text in an editor's fonts, on a canvas. A table's columns are sized from these
 * measurements, because its rows are separate lines of the editor and can't size one another.
 */
class Ruler {
  private readonly context: CanvasRenderingContext2D | null;
  private readonly widths = new Map<string, number>();
  private size = 16;
  private family = "serif";

  constructor(private readonly view: EditorView) {
    const canvas = view.dom.ownerDocument.createElement("canvas");
    this.context = canvas.getContext?.("2d") ?? null;
    this.refresh();
  }

  /**
   * Reads the editor's font again, as after the editor is put on the page or a web font
   * arrives. Returns whether the font is a different one, or `force` is set.
   */
  refresh(force = false): boolean {
    const style = this.view.dom.ownerDocument.defaultView?.getComputedStyle(
      this.view.scrollDOM,
    );
    const size = Number.parseFloat(style?.fontSize ?? "") || 16;
    const family = style?.fontFamily || "serif";
    if (!force && size === this.size && family === this.family) return false;
    this.size = size;
    this.family = family;
    this.widths.clear();
    return true;
  }

  readonly measure: Measure = (text: string, style: TextStyle) => {
    const { context } = this;
    if (!context) return text.length * 0.5;
    const key = `${style.bold ? "b" : ""}${style.italic ? "i" : ""}${style.code ? "c" : ""}:${text}`;
    let width = this.widths.get(key);
    if (width === undefined) {
      const size = style.code ? this.size * 0.9 : this.size;
      const family = style.code ? mono : this.family;
      context.font = `${style.italic ? "italic " : ""}${style.bold ? 650 : 400} ${size}px ${family}`;
      width = context.measureText(text).width / this.size;
      if (this.widths.size > 5000) this.widths.clear();
      this.widths.set(key, width);
    }
    return width;
  };
}

const rulers = new WeakMap<EditorView, Ruler>();

function rulerFor(view: EditorView): Ruler {
  let ruler = rulers.get(view);
  if (!ruler) {
    ruler = new Ruler(view);
    rulers.set(view, ruler);
  }
  return ruler;
}

/** A function that measures text in the editor's fonts. */
export function measureIn(view: EditorView): Measure {
  return rulerFor(view).measure;
}

/**
 * Has the editor's text measured afresh if its font has changed, or in any case when `force` is
 * set. Returns whether measurements made before now are out of date.
 */
export function remeasure(view: EditorView, force = false): boolean {
  return rulerFor(view).refresh(force);
}
