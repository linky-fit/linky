import { createConsole } from "@evolu/common";
import { createNodeJsRelay } from "@evolu/nodejs";
import { mkdirSync } from "node:fs";
import { logRelayError, readOwnerQuotaBytes } from "./config.js";

const ownerQuotaBytes = readOwnerQuotaBytes();

mkdirSync("data", { recursive: true });
process.chdir("data");

const relayConsole = createConsole();
relayConsole.error = logRelayError;
const relay = await createNodeJsRelay({ console: relayConsole })({
  port: 4000,
  enableLogging: false,
  isOwnerWithinQuota: (_ownerId, requiredBytes) =>
    ownerQuotaBytes === 0 || requiredBytes <= ownerQuotaBytes,
});

if (!relay.ok) {
  console.error("[evolu-relay] storage initialization failed");
  process.exit(1);
}
console.info(
  `[evolu-relay] ready port=4000 ownerQuotaBytes=${ownerQuotaBytes === 0 ? "unlimited" : ownerQuotaBytes}`,
);

const shutdown = () => {
  console.info("[evolu-relay] shutting down");
  relay.value[Symbol.dispose]();
  process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
