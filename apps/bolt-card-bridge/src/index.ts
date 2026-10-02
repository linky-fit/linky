import { loadConfig } from "./config";
import { startBridgeServer } from "./server";

const config = loadConfig(Bun.env);
const bridge = startBridgeServer(config);

const SHUTDOWN_GRACE_MS = 5_000;
let shuttingDown = false;

// A signal handler replaces Bun's default exit and `bun --watch` keeps the
// process alive, so it must exit itself or it outlives `bun run dev`, and
// its watcher rebinds the port on the next file change.
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) process.exit(1);
  shuttingDown = true;
  console.info(
    `[bolt-card-bridge] shutting down on ${signal} with ${bridge.sessions.activeCards} active cards`,
  );
  setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS).unref();
  await bridge.stop();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

console.info(
  `[bolt-card-bridge] listening on http://localhost:${bridge.port} for ${config.publicUrl}${config.debug === "off" ? "" : ` with ${config.debug} debug logs`}`,
);
if (config.debug === "raw") {
  console.warn(
    "[bolt-card-bridge] raw debug logs print k1 and invoices verbatim; never enable them in production",
  );
}
