import { loadDaemonConfig } from "./config";
import { startOperatorDaemon } from "./run";

const main = async () => {
  const config = loadDaemonConfig(process.env);
  const daemon = await startOperatorDaemon(config);

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
