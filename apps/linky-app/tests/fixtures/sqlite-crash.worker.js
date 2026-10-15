import sqlite3InitModule from "/sqlite-crash/sqlite3.mjs";

const sqlite = await sqlite3InitModule();
const pool = await sqlite.installOpfsSAHPoolVfs({ name: "crash-recovery" });
const db = new pool.OpfsSAHPoolDb("/recovery.db");

self.onmessage = ({ data }) => {
  try {
    if (data === "interrupt") {
      db.exec("PRAGMA cache_size=1; CREATE TABLE data(value TEXT)");
      db.exec("BEGIN");
      for (let index = 0; index < 100; index += 1) {
        db.exec(
          "INSERT INTO data VALUES ('committed-' || hex(randomblob(4096)))",
        );
      }
      db.exec(
        "COMMIT; BEGIN IMMEDIATE; UPDATE data SET value='uncommitted-' || value",
      );
      // The small cache spills changed pages before COMMIT. Keep the journal hot.
      self.postMessage({
        journal: pool.getFileNames().includes("/recovery.db-journal"),
      });
    } else {
      self.postMessage({
        rows: db.exec(
          "SELECT count(*), sum(value LIKE 'committed-%') FROM data",
          {
            returnValue: "resultRows",
          },
        ),
        integrity: db.exec("PRAGMA integrity_check", {
          returnValue: "resultRows",
        }),
      });
    }
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
self.postMessage("ready");
