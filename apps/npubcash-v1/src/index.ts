import { setGlobalRequestOptions } from "@cashu/cashu-ts";
import { loadConfig } from "./config";
import { Database } from "./db";
import { createHttpHandler, MAX_REQUEST_BODY_BYTES } from "./http";
import { Minter } from "./minter";
import { failure } from "./responses";
import { startWorker } from "./worker";

const config = loadConfig(Bun.env);
// Bounds each mint call, so one unresponsive mint cannot stall the worker or a claim.
setGlobalRequestOptions({ requestTimeout: 10_000 });
const db = new Database(config.databaseUrl);
await db.migrate();
const minter = new Minter(db, config.seed);
const worker = startWorker(db, minter, config.workerIntervalMs);

const server = Bun.serve({
  port: config.port,
  maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
  fetch: createHttpHandler({ config, db, minter }),
  error: () => failure(500, "Something went wrong..."),
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`[npubcash-v1] shutting down on ${signal}`);
  await server.stop();
  await worker.stop();
  await db.close();
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

console.info(`[npubcash-v1] listening on http://localhost:${server.port}`);
