/**
 * Builds the demo site: the page, its script, its styles, its fonts and its icon. The script is
 * split into modules, so that each language's grammar is a file of its own, fetched when a fence
 * first names the language. `buildDemo` builds the site in memory; run as a script, this writes
 * it to `dist/demo`, which is what GitHub Pages publishes.
 */
import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

const root = join(import.meta.dir, "..");

/** The site's files, by the path each is served at. */
export type Site = Map<string, Blob>;

export async function buildDemo(): Promise<Site> {
  const result = await Bun.build({
    entrypoints: [join(root, "demo", "main.ts")],
    target: "browser",
    format: "esm",
    splitting: true,
    minify: true,
  });
  if (!result.success) {
    throw new AggregateError(result.logs, "The demo site failed to build.");
  }

  const site: Site = new Map();
  let styles = "";
  for (const output of result.outputs) {
    const path = output.path.replace(/^\.\//, "");
    if (path.endsWith(".css")) styles = await output.text();
    else site.set(path, output);
  }
  const script = site.get("main.js");
  if (!script || !styles)
    throw new Error("The build produced no script or no styles.");

  // The bundler puts the fonts into the styles as data. Each is written out as a file of its own,
  // so that a browser fetches only the subsets a page uses. Every browser the editor runs in
  // reads WOFF2, so the WOFF copies given as fallbacks are left out.
  styles = styles.replace(
    /,\s*url\(data:font\/woff;base64,[^)]*\)\s*format\([^)]*\)/g,
    "",
  );
  let fonts = 0;
  styles = styles.replace(
    /url\(data:(font\/(\w+));base64,([^)]*)\)/g,
    (_url, type: string, extension: string, data: string) => {
      const bytes = Buffer.from(data, "base64");
      const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
      const name = `font-${hash.slice(0, 12)}.${extension}`;
      site.set(name, new Blob([bytes], { type }));
      fonts++;
      return `url(${name})`;
    },
  );
  if (!fonts) throw new Error("The build found no fonts.");
  site.set("main.css", new Blob([styles], { type: "text/css;charset=utf-8" }));

  // A nonce has to be unguessable to be worth anything, which matters to a page that takes
  // untrusted input and not to this one. Deriving it from the script keeps the build repeatable.
  const nonce = new Bun.CryptoHasher("sha256")
    .update(await script.text())
    .digest("base64url")
    .slice(0, 24);

  // The fonts are redistributed with the site, so the page carries their licences.
  const licences = await Promise.all(
    ["@fontsource-variable/source-serif-4", "@fontsource/ibm-plex-mono"].map(
      async (name) => {
        const file = join(root, "node_modules", name, "LICENSE");
        const text = (await Bun.file(file).text()).replaceAll("-->", "- ->");
        return `${name}\n\n${text.trim()}`;
      },
    ),
  );
  const notice = `<!--\nThis site serves fonts under the following licences.\n\n${licences.join("\n\n")}\n-->`;

  site.set("icon.svg", Bun.file(join(root, "demo", "icon.svg")));

  const template = await Bun.file(join(root, "demo", "index.html")).text();
  const page = `${template.replaceAll("{{nonce}}", nonce).trimEnd()}\n${notice}\n`;
  site.set("index.html", new Blob([page], { type: "text/html;charset=utf-8" }));
  return site;
}

if (import.meta.main) {
  const out = join(root, "dist", "demo");
  const site = await buildDemo();
  await rm(out, { recursive: true, force: true });
  for (const [path, file] of site) {
    await mkdir(dirname(join(out, path)), { recursive: true });
    await Bun.write(join(out, path), file);
  }
  let bytes = 0;
  for (const file of site.values()) bytes += file.size;
  console.log(
    `Wrote ${site.size} files, ${(bytes / 1024).toFixed(0)} kB, to ${join("dist", "demo")}`,
  );
}
