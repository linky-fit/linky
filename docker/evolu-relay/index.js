import { createConsole, Port } from "@evolu/common";
import { installPolyfills } from "@evolu/common/polyfills";
import { createRelay, createRelayDeps, runMain } from "@evolu/nodejs";
import { mkdirSync } from "node:fs";
import { readOwnerQuotaBytes, relayConsoleOutput } from "./config.js";

installPolyfills();

const ownerQuotaBytes = readOwnerQuotaBytes();

mkdirSync("data", { recursive: true });
process.chdir("data");

process.once("SIGINT", () => console.info("[evolu-relay] shutting down"));
process.once("SIGTERM", () => console.info("[evolu-relay] shutting down"));

await runMain({
  ...createRelayDeps(),
  console: createConsole({ level: "debug", output: relayConsoleOutput }),
})(async (run) => {
  const relay = await run(
    createRelay({
      port: Port.orThrow(4000),
      isOwnerWithinQuota: (_ownerId, requiredBytes) =>
        ownerQuotaBytes === 0 || requiredBytes <= ownerQuotaBytes,
    }),
  );
  if (relay.ok)
    console.info(
      `[evolu-relay] ready port=4000 ownerQuotaBytes=${ownerQuotaBytes === 0 ? "unlimited" : ownerQuotaBytes}`,
    );
  return relay;
});
