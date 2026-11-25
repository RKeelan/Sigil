/**
 * Serves the demo site at http://localhost:5850, or on the port `PORT` names. The site is built
 * in memory when the server starts. With `--watch`, it is built again whenever a file in `src` or
 * `demo` changes, so that reloading the page shows the latest source; a build that fails leaves
 * the last good one in place.
 */
import { watch } from "node:fs";
import { join } from "node:path";
import { buildDemo, type Site } from "./build-demo.ts";

const root = join(import.meta.dir, "..");
const port = Number(process.env.PORT ?? 5850);

let site: Site = await buildDemo();

Bun.serve({
  port,
  hostname: "localhost",
  fetch(request) {
    const path = new URL(request.url).pathname.slice(1) || "index.html";
    const file = site.get(path);
    if (!file) return new Response("Not found", { status: 404 });
    return new Response(file, { headers: { "Cache-Control": "no-store" } });
  },
});
console.log(`Serving the demo site at http://localhost:${port}/`);

if (process.argv.includes("--watch")) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let building = false;
  let again = false;
  // Builds one at a time, so that an older build can't finish last and replace a newer one.
  const rebuild = async () => {
    if (building) {
      again = true;
      return;
    }
    building = true;
    do {
      again = false;
      const started = performance.now();
      try {
        site = await buildDemo();
        const took = (performance.now() - started).toFixed(0);
        console.log(`Rebuilt the demo site in ${took} ms`);
      } catch (error) {
        console.error(error);
      }
    } while (again);
    building = false;
  };
  // An editor saving a file can change it several times in quick succession.
  const changed = () => {
    clearTimeout(timer);
    timer = setTimeout(rebuild, 100);
  };
  for (const dir of ["src", "demo"])
    watch(join(root, dir), { recursive: true }, changed);
  console.log("Watching src and demo for changes");
}
