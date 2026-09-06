// Local-dev Evolu relay. We run our own instead of the official
// evoluhq/relay image because that image hardcodes a 1MB-per-owner quota;
// pinned deps must stay protocol-compatible with the web app's
// @evolu/common version (see apps/web-app/package.json).
import { createConsole } from "@evolu/common";
import { createNodeJsRelay } from "@evolu/nodejs";
import { mkdirSync } from "node:fs";

const ownerQuotaBytes = Number(process.env.EVOLU_OWNER_QUOTA_BYTES ?? 0);
if (!Number.isSafeInteger(ownerQuotaBytes) || ownerQuotaBytes < 0) {
  throw new Error("EVOLU_OWNER_QUOTA_BYTES must be a non-negative integer");
}

mkdirSync("data", { recursive: true });
process.chdir("data");

const relay = await createNodeJsRelay({ console: createConsole() })({
  port: 4000,
  enableLogging: true,
  isOwnerWithinQuota: (_ownerId, requiredBytes) =>
    ownerQuotaBytes === 0 || requiredBytes <= ownerQuotaBytes,
});

if (!relay.ok) {
  console.error(relay.error);
  process.exit(1);
}
const shutdown = () => {
  relay.value[Symbol.dispose]();
  process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
