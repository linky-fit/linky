import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const sqliteDir = join(
  dirname(require.resolve("@evolu/sqlite-wasm/package.json")),
  "sqlite-wasm/jswasm",
);

test.use({ serviceWorkers: "block" });

for (const bundle of [
  "sqlite3-bundler-friendly.mjs",
  "sqlite3.mjs",
  "sqlite3.js",
]) {
  test(`${bundle} rolls back an interrupted transaction after its worker dies`, async ({
    page,
  }) => {
    await page.route("**/sqlite-crash/", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>SQLite crash recovery</title>",
      }),
    );
    await page.route("**/sqlite-crash/sqlite3.mjs", async (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body:
          (await readFile(join(sqliteDir, bundle), "utf8")) +
          (bundle.endsWith(".js")
            ? "\nexport default globalThis.sqlite3InitModule;"
            : ""),
      }),
    );
    await page.route("**/sqlite3.wasm", async (route) =>
      route.fulfill({
        contentType: "application/wasm",
        body: await readFile(join(sqliteDir, "sqlite3.wasm")),
      }),
    );
    await page.route("**/sqlite-crash/worker.js", async (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body: await readFile(
          new URL("./fixtures/sqlite-crash.worker.js", import.meta.url),
          "utf8",
        ),
      }),
    );
    await page.goto("/sqlite-crash/");

    const runWorker = (command: "interrupt" | "read") =>
      page.evaluate(
        (command) =>
          new Promise<unknown>((resolve, reject) => {
            const worker = new Worker("/sqlite-crash/worker.js", {
              type: "module",
            });
            worker.onerror = (event) => reject(new Error(event.message));
            worker.onmessage = (event: MessageEvent<unknown>) => {
              if (event.data === "ready") worker.postMessage(command);
              else {
                worker.terminate();
                resolve(event.data);
              }
            };
          }),
        command,
      );
    expect(await runWorker("interrupt")).toEqual({ journal: true });

    await page.reload();
    const recovered = await runWorker("read");
    expect(recovered).toEqual({ rows: [[100, 100]], integrity: [["ok"]] });
  });
}
