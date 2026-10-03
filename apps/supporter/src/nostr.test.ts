import {
  derivePubkey,
  NostrSecretKey,
  OutboxRef,
  OutboxStore,
  UnixSeconds,
  verifySupporterAward,
} from "@linky-fit/linkstr";
import { Bip39Seed } from "@linky-fit/linkshu";
import { afterEach, describe, expect, it } from "bun:test";
import { Effect, Either } from "effect";
import {
  createMessenger,
  makeNostrRuntime,
  supporterResultRef,
  tokenHashOfRef,
} from "./nostr";
import type { NostrRuntime } from "./nostr";
import type { ResultDelivery } from "./pipeline";
import { SupporterStorage, TokenHash } from "./storage";
import { testPubkey, testRumorId } from "./testSupport";

const secretKey = NostrSecretKey.make(new Uint8Array(32).fill(7));
const bot = derivePubkey(secretKey);
const supporter = testPubkey(1);
const tokenHash = TokenHash.make("e".repeat(64));

const runtimes: NostrRuntime[] = [];
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
});

/** A linkstr runtime without relays: the outbox stores jobs and never delivers. */
const setup = () => {
  const storage = new SupporterStorage(":memory:");
  const runtime = makeNostrRuntime(
    { secretKey, pubkey: bot, cashuSeed: Bip39Seed.make(new Uint8Array(64)) },
    {
      relays: [],
      allowInsecureLocalhostRelays: false,
      storage: storage.linkstrStorage,
    },
  );
  runtimes.push(runtime);
  const queuedRefs = () =>
    Effect.runSync(
      Effect.flatMap(OutboxStore, (store) => store.loadAll).pipe(
        Effect.provide(
          OutboxStore.fromStringStorage(storage.linkstrStorage, "outbox"),
        ),
      ),
    ).map((job) => job.ref);
  return {
    messenger: createMessenger(runtime, storage.linkstrStorage),
    queuedRefs,
  };
};

describe("supporter result refs", () => {
  it("name the payment they answer and nothing else", () => {
    expect(tokenHashOfRef(supporterResultRef(tokenHash))).toBe(tokenHash);
    expect(
      tokenHashOfRef(OutboxRef.make("auto-reply:npub1…:2026-10-03")),
    ).toBeNull();
    expect(
      tokenHashOfRef(OutboxRef.make(`supporter-result:${"x".repeat(64)}`)),
    ).toBeNull();
  });
});

describe("linkstr messenger", () => {
  it("signs a tiered and a generic award that verify against Linky Bot", async () => {
    const { messenger } = setup();
    const awardedAt = UnixSeconds.make(1_790_000_000);
    const awards = await messenger.signAwards(supporter, "gold", awardedAt);
    expect(
      awards.map((award) =>
        Either.map(verifySupporterAward(award, bot, supporter), (verified) => [
          verified.badge,
          verified.awardedAt,
        ]),
      ),
    ).toEqual([
      Either.right(["gold", awardedAt]),
      Either.right(["generic", awardedAt]),
    ]);
  });

  it("queues a payment's result in the outbox once", async () => {
    const { messenger, queuedRefs } = setup();
    const delivery: ResultDelivery = {
      to: supporter,
      tokenMessageId: testRumorId("1"),
      tokenHash,
      result: { status: "thanks" },
    };
    await messenger.sendResult(delivery);
    await messenger.sendResult(delivery);
    expect(queuedRefs()).toEqual([supporterResultRef(tokenHash)]);
  });
});
