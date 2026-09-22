import { loadConfig } from "./config";
import { createHttpHandler, errorResponse } from "./http";
import { OwnershipVerifier } from "./ownership";
import { PushDeliveryService } from "./push";
import { InMemoryRateLimiter } from "./rateLimit";
import { MAX_REQUEST_BODY_BYTES } from "./requestSecurity";
import { RelayWatcher } from "./relayWatcher";
import { ReminderDispatcher } from "./reminderDispatcher";
import { PushStorage } from "./storage";

const config = loadConfig(Bun.env);
const storage = new PushStorage(config.storagePath);
const ownershipVerifier = new OwnershipVerifier({
  proofMaxAgeSeconds: config.proofMaxAgeSeconds,
  loadChallenge: (nonce) => storage.getChallenge(nonce),
});
const rateLimiter = new InMemoryRateLimiter();
const pushDelivery = new PushDeliveryService({
  firebaseServiceAccountJson: config.firebaseServiceAccountJson,
  vapidSubject: config.vapidSubject,
  vapidPublicKey: config.vapidPublicKey,
  vapidPrivateKey: config.vapidPrivateKey,
  storage,
});
const relayWatcher = new RelayWatcher({
  relayUrls: config.defaultRelays,
  storage,
  pushDelivery,
});

const reminderDispatcher = new ReminderDispatcher({ storage, pushDelivery });

relayWatcher.start();
reminderDispatcher.start();
const cleanupTimer = setInterval(() => {
  const nowMs = Date.now();
  storage.pruneChallenges(nowMs);
  relayWatcher.pruneSeen(nowMs);
  rateLimiter.prune(nowMs);
}, 60 * 1000);

const server = Bun.serve({
  port: config.port,
  maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
  fetch: createHttpHandler({
    config,
    storage,
    ownershipVerifier,
    rateLimiter,
    pushDelivery,
  }),
  error(error: unknown) {
    return errorResponse(config, null, error);
  },
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.info(`[push] shutting down on ${signal}`);
  clearInterval(cleanupTimer);
  await relayWatcher.stop();
  await reminderDispatcher.stop();
  storage.close();
  server.stop(true);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

console.info(
  `[push] listening on http://localhost:${server.port} with relays ${config.defaultRelays.join(", ")}`,
);
