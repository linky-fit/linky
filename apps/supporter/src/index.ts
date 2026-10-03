import { encodeNpub } from "@linky-fit/linkstr";
import { Effect, Fiber } from "effect";
import { CLI_USAGE, isCliCommand, runCli } from "./cli";
import { loadConfig, readRecoverySeed } from "./config";
import { createHttpHandler } from "./http";
import { deriveBotIdentity } from "./identity";
import { createInboxHandler } from "./inbox";
import { logInfo, logWarn } from "./log";
import {
  consumeOutboxResults,
  createMessenger,
  makeNostrRuntime,
  runInbox,
  sendAutoReply,
  tokenHashOfRef,
} from "./nostr";
import { createPaymentPipeline } from "./pipeline";
import { publishBotEvents } from "./profile";
import { SupporterStorage } from "./storage";
import { createLinkshuWallet, makeWalletRuntime } from "./wallet";

const RETRY_INTERVAL_MS = 60_000;

const serve = async (): Promise<void> => {
  const config = loadConfig(Bun.env);
  const identity = await deriveBotIdentity(readRecoverySeed(Bun.env));
  const storage = new SupporterStorage(config.storagePath);
  const walletRuntime = makeWalletRuntime(identity.cashuSeed, storage.db);
  const nostrRuntime = makeNostrRuntime(identity, {
    relays: config.relays,
    allowInsecureLocalhostRelays: config.allowInsecureLocalhostRelays,
    storage: storage.linkstrStorage,
  });

  const pipeline = createPaymentPipeline({
    payments: storage,
    wallet: createLinkshuWallet(walletRuntime),
    messenger: createMessenger(nostrRuntime, storage.linkstrStorage),
    acceptedMints: config.acceptedMints,
  });
  const retry = () =>
    pipeline
      .retryUnfinished()
      .catch((error: unknown) => logWarn("retry pass failed", error));

  const outboxFiber = consumeOutboxResults(nostrRuntime, async (ref) => {
    const tokenHash = tokenHashOfRef(ref);
    if (tokenHash !== null) await pipeline.confirmDelivered(tokenHash);
  });
  const profileFiber = nostrRuntime.runFork(
    publishBotEvents(identity.pubkey, config.relays),
  );
  await retry();
  const inboxFiber = runInbox(
    nostrRuntime,
    createInboxHandler({
      handleToken: pipeline.handleToken,
      claimAutoReply: (sender, day) => storage.claimAutoReply(sender, day),
      sendAutoReply: sendAutoReply(nostrRuntime),
    }),
  );
  const retryTimer = setInterval(() => void retry(), RETRY_INTERVAL_MS);

  const server = Bun.serve({
    port: config.port,
    fetch: createHttpHandler(config.buildCommitSha),
  });
  logInfo(
    `listening on port ${server.port} as ${encodeNpub(identity.pubkey)} relays=${config.relays.join(",")} mints=${config.acceptedMints.join(",")}`,
  );

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logInfo(`shutting down on ${signal}`);
    clearInterval(retryTimer);
    await server.stop();
    await Effect.runPromise(
      Fiber.interruptAll([inboxFiber, profileFiber, outboxFiber]),
    );
    await nostrRuntime.dispose();
    await walletRuntime.dispose();
    storage.close();
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
};

const main = async (): Promise<number> => {
  const [name] = process.argv.slice(2);
  if (name === undefined) {
    await serve();
    return 0;
  }
  if (!isCliCommand(name)) {
    console.error(CLI_USAGE);
    return 1;
  }
  const config = loadConfig(Bun.env);
  const identity = await deriveBotIdentity(readRecoverySeed(Bun.env));
  const storage = new SupporterStorage(config.storagePath);
  try {
    return await runCli(process.argv.slice(2), identity.cashuSeed, storage.db);
  } finally {
    storage.close();
  }
};

main().then(
  (code) => {
    if (code !== 0) process.exitCode = code;
  },
  (error: unknown) => {
    console.error(
      `[supporter] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  },
);
