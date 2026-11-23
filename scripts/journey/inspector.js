// Read-only inspector log dump from the device's browser, for `bun run journey inspector <device> [tag]`.
// Works on every Linky origin (unhooked production, hooked, and last release).
// playwright-cli calls this file as one expression, so it ends without a semicolon.
async (page, { tag }) =>
  page.evaluate(async (wantedTag) => {
    const inspectorEnabled =
      localStorage.getItem("linky.inspector_enabled") === "true";
    const logsEnabled =
      localStorage.getItem("linky.inspector_logs_enabled") === "true";

    const readIndexedDb = () =>
      new Promise((resolve) => {
        const open = indexedDB.open("linky.inspector_logs", 1);
        open.onupgradeneeded = () => {
          if (!open.result.objectStoreNames.contains("rows")) {
            open.result.createObjectStore("rows", { keyPath: "id" });
          }
        };
        open.onerror = () => resolve([]);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("rows")) {
            db.close();
            resolve([]);
            return;
          }
          const tx = db.transaction("rows", "readonly");
          const req = tx.objectStore("rows").getAll();
          req.onsuccess = () => {
            db.close();
            resolve(Array.isArray(req.result) ? req.result : []);
          };
          req.onerror = () => {
            db.close();
            resolve([]);
          };
        };
      });

    const sourceRows =
      logsEnabled
        ? await readIndexedDb()
        : window.__linkyE2E?.inspectorRows
          ? window.__linkyE2E.inspectorRows()
          : await readIndexedDb();

    const filtered = wantedTag
      ? sourceRows.filter(
          (row) => row?.tag === wantedTag || row?.channel === wantedTag,
        )
      : sourceRows;

    const latest = filtered.slice(-100).map((row) => ({
      at: row.at,
      channel: row.channel,
      tag: row.tag,
      summary: row.summary,
      payload: row.payload,
    }));

    return {
      inspectorEnabled,
      logsEnabled,
      total: sourceRows.length,
      matched: filtered.length,
      rows: latest,
    };
  }, tag ?? null)
