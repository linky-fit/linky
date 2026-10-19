// Serves the export like docker/linky-app/nginx.conf: files as they are, any
// other path as index.html, so a path route survives a reload.
import { join, sep } from "node:path";

const dist = join(import.meta.dir, "../dist");
const port = Number(process.argv[2] ?? 5181);
// Misses under these answer 404 instead of index.html.
const NO_FALLBACK = /^\/(api|assets|_expo|fonts|licenses|sqlite-wasm|vendor)\//;

Bun.serve({
  port,
  async fetch(request) {
    const { pathname } = new URL(request.url);
    const path = join(dist, decodeURIComponent(pathname));
    const file = Bun.file(path);
    if (path.startsWith(dist + sep) && (await file.exists()))
      return new Response(file);
    if (NO_FALLBACK.test(pathname))
      return new Response("Not found", { status: 404 });
    return new Response(Bun.file(join(dist, "index.html")));
  },
});
console.log(`Serving ${dist} on http://localhost:${port}`);
