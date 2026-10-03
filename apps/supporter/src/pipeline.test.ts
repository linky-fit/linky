import { EventId, SignedPlainEvent, UnixSeconds } from "@linky-fit/linkstr";
import { beforeEach, describe, expect, it, spyOn } from "bun:test";
import { createPaymentPipeline, tokenHashOf } from "./pipeline";
import type {
  ReceiveOutcome,
  ResultDelivery,
  SupporterMessenger,
  SupporterWallet,
} from "./pipeline";
import { SupporterStorage } from "./storage";
import type { TokenHash } from "./storage";
import { TEST_MINT, testPubkey, testRumorId, tokenText } from "./testSupport";

const NOW_MS = 1_790_000_000_000;
const sender = testPubkey(1);

const award = (fill: string) =>
  new SignedPlainEvent({
    id: EventId.make(fill.repeat(64)),
    pubkey: testPubkey(9),
    created_at: UnixSeconds.make(NOW_MS / 1000),
    kind: 8,
    tags: [],
    content: "",
    sig: fill.repeat(128),
  });

const setup = (outcomes: ReceiveOutcome[] = ["received"]) => {
  const storage = new SupporterStorage(":memory:");
  const received: string[] = [];
  const delivered: ResultDelivery[] = [];
  const sendCalls: TokenHash[] = [];
  const signed: Array<[string, string, number]> = [];
  const state = {
    stillDeferred: new Set<TokenHash>(),
    recorded: new Map<TokenHash, string>(),
    failNextSend: false,
  };
  const wallet: SupporterWallet = {
    receive: (text) => {
      received.push(text);
      return Promise.resolve(outcomes.shift() ?? "received");
    },
    resumeDeferred: () => Promise.resolve(state.stillDeferred),
    findTokenText: (hash) => Promise.resolve(state.recorded.get(hash) ?? null),
  };
  const messenger: SupporterMessenger = {
    signAwards: (supporter, tier, awardedAt) => {
      signed.push([supporter, tier, awardedAt]);
      return Promise.resolve([award("a"), award("b")]);
    },
    // Like the outbox messenger: a result already queued is not queued again.
    sendResult: (delivery) => {
      if (state.failNextSend) {
        state.failNextSend = false;
        return Promise.reject(new Error("outbox down"));
      }
      sendCalls.push(delivery.tokenHash);
      if (!delivered.some((queued) => queued.tokenHash === delivery.tokenHash))
        delivered.push(delivery);
      return Promise.resolve();
    },
  };
  const pipeline = createPaymentPipeline({
    payments: storage,
    wallet,
    messenger,
    acceptedMints: [TEST_MINT],
    nowMs: () => NOW_MS,
  });
  const pay = (token: string, rumor = "1") =>
    pipeline.handleToken({ from: sender, rumorId: testRumorId(rumor), token });
  return {
    storage,
    state,
    pipeline,
    pay,
    received,
    delivered,
    sendCalls,
    signed,
  };
};

beforeEach(() => {
  spyOn(console, "info").mockImplementation(() => {});
  spyOn(console, "warn").mockImplementation(() => {});
});

describe("payment pipeline", () => {
  it("receives an accepted payment, signs both awards and queues the result", async () => {
    const { pay, pipeline, storage, received, signed, delivered } = setup();
    const token = tokenText(20_000);
    await pay(token);

    expect(received).toEqual([token]);
    expect(signed).toEqual([[sender, "silver", NOW_MS / 1000]]);
    expect(delivered).toEqual([
      {
        to: sender,
        tokenMessageId: testRumorId("1"),
        tokenHash: tokenHashOf(token),
        result: {
          status: "issued",
          tier: "silver",
          awards: [award("a"), award("b")],
        },
      },
    ]);
    expect(storage.findPayment(tokenHashOf(token))).toMatchObject({
      amount: 20_000,
      tier: "silver",
      state: "ready",
    });

    await pipeline.confirmDelivered(tokenHashOf(token));
    expect(storage.findPayment(tokenHashOf(token))?.state).toBe("delivered");
  });

  it("stops at a delivered result and ignores confirmations of unknown payments", async () => {
    const { pay, pipeline, storage, sendCalls } = setup();
    const token = tokenText(5_000);
    await pay(token);
    await pipeline.confirmDelivered(tokenHashOf(token));
    await pay(token, "2");
    await pipeline.retryUnfinished();
    await pipeline.confirmDelivered(tokenHashOf(tokenText(7_000)));
    expect(sendCalls).toHaveLength(1);
    expect(storage.unfinishedPayments()).toEqual([]);
  });

  it("thanks a payment below Bronze without signing awards", async () => {
    const { pay, signed, delivered } = setup();
    await pay(tokenText(4_999));
    expect(signed).toEqual([]);
    expect(delivered.map((delivery) => delivery.result)).toEqual([
      { status: "thanks" },
    ]);
  });

  it("refuses a token from a mint outside the list without receiving it", async () => {
    const { pay, storage, received, delivered } = setup();
    const token = tokenText(50_000, { mint: "https://other.example" });
    await pay(token);
    expect(received).toEqual([]);
    expect(delivered.map((delivery) => delivery.result)).toEqual([
      { status: "refused", reason: "mint_not_accepted" },
    ]);
    expect(storage.findPayment(tokenHashOf(token))?.tier).toBeNull();
  });

  it("refuses a token in another unit and an unreadable one", async () => {
    const { pay, received, delivered } = setup();
    await pay(tokenText(50_000, { unit: "usd" }));
    await pay("cashuBnot-a-token", "2");
    expect(received).toEqual([]);
    expect(delivered.map((delivery) => delivery.result)).toEqual([
      { status: "refused", reason: "invalid_token" },
      { status: "refused", reason: "invalid_token" },
    ]);
  });

  it("refuses a spent token and an invalid one the wallet rejects", async () => {
    const { pay, delivered } = setup(["spent", "invalid"]);
    await pay(tokenText(5_000));
    await pay(tokenText(6_000), "2");
    expect(delivered.map((delivery) => delivery.result)).toEqual([
      { status: "refused", reason: "token_spent" },
      { status: "refused", reason: "invalid_token" },
    ]);
  });

  it("answers a token once, whichever rumor carries it", async () => {
    const { pay, received, delivered } = setup();
    const token = tokenText(5_000);
    await Promise.all([pay(token, "1"), pay(token, "2")]);
    await pay(token, "3");
    expect(received).toHaveLength(1);
    expect(delivered).toHaveLength(1);
  });

  it("queues a stored result again until it is in the outbox, once", async () => {
    const { pay, state, storage, received, signed, delivered } = setup();
    const token = tokenText(5_000);
    state.failNextSend = true;
    await expect(pay(token)).rejects.toThrow("outbox down");
    expect(storage.findPayment(tokenHashOf(token))?.state).toBe("ready");

    await pay(token, "2");
    await pay(token, "3");
    expect(received).toHaveLength(1);
    expect(signed).toHaveLength(1);
    expect(delivered.map((delivery) => delivery.tokenMessageId)).toEqual([
      testRumorId("1"),
    ]);
  });

  it("finishes a deferred receive on the retry pass once its mint is back", async () => {
    const { pay, pipeline, state, storage, received, delivered } = setup([
      "deferred",
    ]);
    const token = tokenText(50_000);
    const hash = tokenHashOf(token);
    await pay(token);
    expect(storage.findPayment(hash)?.state).toBe("deferred");

    state.recorded.set(hash, token);
    state.stillDeferred = new Set([hash]);
    await pipeline.retryUnfinished();
    expect(received).toHaveLength(1);

    state.stillDeferred = new Set();
    await pipeline.retryUnfinished();
    expect(received).toHaveLength(2);
    expect(delivered.map((delivery) => delivery.result.status)).toEqual([
      "issued",
    ]);
    expect(storage.findPayment(hash)?.state).toBe("ready");
  });

  it("resumes a payment interrupted before its result from the wallet's record", async () => {
    const { pay, pipeline, state, received, delivered } = setup(["retry"]);
    const token = tokenText(5_000);
    await pay(token);
    expect(delivered).toEqual([]);

    await pipeline.retryUnfinished();
    expect(received).toHaveLength(1);

    state.recorded.set(tokenHashOf(token), token);
    await pipeline.retryUnfinished();
    expect(received).toHaveLength(2);
    expect(delivered.map((delivery) => delivery.result.status)).toEqual([
      "issued",
    ]);
  });

  it("delivers stored results on the retry pass", async () => {
    const { pay, pipeline, state, delivered } = setup();
    state.failNextSend = true;
    await expect(pay(tokenText(5_000))).rejects.toThrow();
    await pipeline.retryUnfinished();
    await pipeline.retryUnfinished();
    expect(delivered).toHaveLength(1);
  });
});
