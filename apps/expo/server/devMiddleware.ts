import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import {
  linkPreviewMiddleware,
  lnurlpMiddleware,
  type DevMiddleware,
} from "@linky-fit/linky-app/server/devApi.ts";
import {
  createInspectorCollector,
  inspectorRowsFile,
} from "@linky-fit/linky-app/server/inspectorCollector.ts";

const webAppRoot = path.dirname(
  createRequire(import.meta.url).resolve("@linky-fit/linky-app/package.json"),
);

const chain =
  (middlewares: readonly DevMiddleware[]): DevMiddleware =>
  (req, res, next) => {
    const run = (index: number): void | Promise<void> => {
      const middleware = middlewares[index];
      return middleware ? middleware(req, res, () => run(index + 1)) : next();
    };
    return run(0);
  };

/** apps/linky-app/inspector.html, loading its entry as a Metro dev bundle. */
const inspectorPage =
  (serverRoot: string): DevMiddleware =>
  async (req, res, next) => {
    if (req.method !== "GET" || req.url?.split("?")[0] !== "/inspector.html")
      return next();
    const entry = path.relative(
      serverRoot,
      path.join(import.meta.dirname, "../inspector.ts"),
    );
    // The query Expo puts on its own index.html bundle URL.
    const bundle = `/${entry}.bundle?platform=web&dev=true&hot=false&lazy=true&transform.engine=hermes&transform.routerRoot=app&unstable_transformProfile=hermes-stable`;
    const html = (
      await readFile(path.join(webAppRoot, "inspector.html"), "utf8")
    ).replace(
      /<script type="module" src="[^"]+"><\/script>/,
      `<script src="${bundle}" defer></script>`,
    );
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(html);
  };

/** The dev-only routes vite.config.ts mounts, in front of Metro. */
export const withDevMiddleware = (
  metroMiddleware: DevMiddleware,
  { port, serverRoot }: { port: number; serverRoot: string },
): DevMiddleware => {
  // Rows land next to the Vite dev server's, told apart by port.
  const collector = createInspectorCollector(
    inspectorRowsFile(webAppRoot, port),
    console,
  );
  const inspector: DevMiddleware = async (req, res, next) =>
    (await collector).middleware(req, res, next);
  return chain([
    lnurlpMiddleware,
    linkPreviewMiddleware(console),
    inspector,
    inspectorPage(serverRoot),
    metroMiddleware,
  ]);
};
