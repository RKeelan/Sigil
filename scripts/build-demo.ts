/**
 * Builds the demo page as one self-contained file, `dist/demo/index.html`, that opens from disk:
 * the script, the styles and the fonts are all inside it, and nothing is fetched.
 */
import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";

const root = join(import.meta.dir, "..");
const out = join(root, "dist", "demo");

const result = await Bun.build({
  entrypoints: [join(root, "demo", "main.ts")],
  target: "browser",
  format: "iife",
  minify: true,
  naming: { asset: "[name].[ext]" },
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

let script = "";
let styles = "";
for (const output of result.outputs) {
  const name = basename(output.path);
  if (name.endsWith(".js")) script = await output.text();
  else if (name.endsWith(".css")) styles = await output.text();
}
if (!script || !styles)
  throw new Error("The build produced no script or no styles.");

/** Whether a `unicode-range` value takes in a code point. */
function covers(range: string, codePoint: number): boolean {
  return range.split(",").some((part) => {
    const match = /U\+([0-9A-F?]+)(?:-([0-9A-F]+))?/i.exec(part);
    if (!match) return false;
    // A "?" stands for any digit, so "U+??" is U+00 to U+FF.
    const start = match[1] as string;
    const from = Number.parseInt(start.replaceAll("?", "0"), 16);
    const to = Number.parseInt(match[2] ?? start.replaceAll("?", "F"), 16);
    return from <= codePoint && codePoint <= to;
  });
}

// The bundler puts every font into the styles as data. The page keeps only the subsets that
// cover Latin text, "A" and "ā" standing for basic and extended Latin, and only the first
// format of each. Text in other scripts falls back to the fonts of the machine it is read on.
let kept = 0;
styles = styles.replace(/@font-face\s*\{[^}]*\}/g, (face) => {
  const range = /unicode-range:([^;}]*)/.exec(face)?.[1];
  if (range && !covers(range, 0x41) && !covers(range, 0x101)) return "";
  kept++;
  return face.replace(/(src:url\([^)]*\)(?:\s*format\([^)]*\))?)[^;}]*/, "$1");
});
if (!kept) throw new Error("The build found no fonts to embed.");

// A nonce has to be unguessable to be worth anything, which matters to a page that takes
// untrusted input and not to this one. Deriving it from the script keeps the build repeatable.
const nonce = new Bun.CryptoHasher("sha256")
  .update(script)
  .digest("base64url")
  .slice(0, 24);

// The fonts are redistributed inside the page, so the page carries their licences.
const licences = await Promise.all(
  ["@fontsource-variable/source-serif-4", "@fontsource/ibm-plex-mono"].map(
    async (name) => {
      const file = join(root, "node_modules", name, "LICENSE");
      const text = (await Bun.file(file).text()).replaceAll("-->", "- ->");
      return `${name}\n\n${text.trim()}`;
    },
  ),
);
const notice = `<!--\nThis page embeds fonts under the following licences.\n\n${licences.join("\n\n")}\n-->`;

const template = await Bun.file(join(root, "demo", "index.html")).text();
const fill = (page: string, mark: string, content: string) => {
  if (!page.includes(mark)) throw new Error(`The page has no ${mark}.`);
  return page.replace(mark, () => content);
};
let page = template.replaceAll("{{nonce}}", nonce);
page = fill(page, "<!--styles-->", `<style nonce="${nonce}">${styles}</style>`);
page = fill(
  page,
  "<!--script-->",
  `<script nonce="${nonce}">${script.replaceAll("</script", "<\\/script")}</script>`,
);

page = `${page.trimEnd()}\n${notice}\n`;

await mkdir(out, { recursive: true });
await Bun.write(join(out, "index.html"), page);
const size = (Buffer.byteLength(page) / 1024).toFixed(0);
console.log(`Wrote ${join("dist", "demo", "index.html")} (${size} kB)`);
