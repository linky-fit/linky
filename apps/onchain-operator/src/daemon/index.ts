import * as fs from "node:fs";
import * as path from "node:path";
import { loadDaemonConfig } from "./config";
import { startOperatorDaemon } from "./run";

const main = async () => {
  const config = loadDaemonConfig(process.env);
  const dataDir = path.resolve(config.dataDir);
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  // Evolu's Node.js SQLite driver stores its database in the working directory.
  process.chdir(dataDir);
  const daemon = await startOperatorDaemon({ ...config, dataDir });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[onchain-operator-daemon] Received ${signal}, shutting down…`);
    void daemon.stop().then(
      () => process.exit(0),
      (error: unknown) => {
        console.error("[onchain-operator-daemon] Shutdown failed", error);
        process.exit(1);
      },
    );
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[onchain-operator-daemon] Fatal: ${message}`);
  process.exit(1);
});
