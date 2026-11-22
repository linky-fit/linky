// What the page's origin stores, for `bun run journey inventory <device>`.
// playwright-cli calls this file as one expression, so it ends without a semicolon.
async (page) =>
  JSON.stringify(
    await page.evaluate(async () => {
      const safe = async (read) => {
        try {
          return await read();
        } catch (error) {
          return `ERROR ${error?.name}: ${error?.message}`;
        }
      };
      const walk = async (dir, depth) => {
        const entries = [];
        for await (const [name, handle] of dir.entries()) {
          entries.push(
            handle.kind === "file"
              ? {
                  name,
                  size: await safe(async () => (await handle.getFile()).size),
                }
              : {
                  name,
                  children:
                    depth > 0 ? await safe(() => walk(handle, depth - 1)) : "…",
                },
          );
        }
        return entries.sort((a, b) => a.name.localeCompare(b.name));
      };
      const worker = (w) => w && { url: w.scriptURL, state: w.state };
      return {
        url: location.href,
        at: new Date().toISOString(),
        entryScripts: [
          ...document.querySelectorAll('script[type="module"][src]'),
        ].map((script) => new URL(script.src).pathname),
        serviceWorkers: await safe(async () =>
          (await navigator.serviceWorker.getRegistrations()).map((r) => ({
            active: worker(r.active),
            waiting: worker(r.waiting),
            installing: worker(r.installing),
          })),
        ),
        opfs: await safe(async () =>
          walk(await navigator.storage.getDirectory(), 2),
        ),
        localStorageKeys: Object.keys(localStorage).sort(),
        indexedDB: await safe(async () =>
          (await indexedDB.databases())
            .map((db) => `${db.name} v${db.version}`)
            .sort(),
        ),
        caches: await safe(() => caches.keys()),
        persisted: await safe(() => navigator.storage.persisted()),
      };
    }),
  )
