import { Chunk, Effect, Either, Layer, Option, Stream } from "effect";
import { Chat } from "../chat/Chat";
import {
  ChatMessageReceipt,
  MessageText,
  TextMessageDraft,
} from "../chat/domain";
import { ClientId, RelayUrl, RumorId, UnixSeconds } from "../domain/primitives";
import { unwrapToRumor } from "../internal/giftWrap";
import type { SignedWrapEvent } from "../internal/nostrEvent";
import {
  PaymentTelemetryDraft,
  PaymentTelemetryReceipt,
} from "../paymentTelemetry/domain";
import { PaymentTelemetry } from "../paymentTelemetry/PaymentTelemetry";
import { Emoji, ReactionDraft, ReactionReceipt } from "../reactions/domain";
import { Reactions } from "../reactions/Reactions";
import { LinkstrIdentity } from "../services/LinkstrIdentity";
import type { LinkstrIdentityService } from "../services/LinkstrIdentity";
import type { NostrTransport } from "../services/NostrTransport";
import { RelayPolicy } from "../services/RelayPolicy";
import {
  eventually,
  makeIdentity,
  recipientOf,
  stubWrapTransport,
} from "../testing";
import { OutboxRef } from "./domain";
import type { RumorFixedOperation } from "./domain";
import { Outbox } from "./Outbox";
import { OutboxStore } from "./OutboxStore";
import type { OutboxStoreService } from "./OutboxStore";

const alice = makeIdentity();
const bob = makeIdentity();
const relay = RelayUrl.make("wss://relay.test");

const makeStore = (): OutboxStoreService =>
  Effect.runSync(OutboxStore.pipe(Effect.provide(OutboxStore.inMemory)));

/** `behavior.accept` is read per publish, so a test can flip it mid-run. */
const stubTransport = (
  published: Array<SignedWrapEvent>,
  behavior: { accept: boolean },
): Layer.Layer<NostrTransport> =>
  stubWrapTransport(published, () => behavior.accept);

const outboxLayer = (
  identity: LinkstrIdentityService,
  store: OutboxStoreService,
  transport: Layer.Layer<NostrTransport>,
): Layer.Layer<Outbox> =>
  Outbox.Default.pipe(
    Layer.provide([
      Chat.Default,
      Reactions.Default,
      PaymentTelemetry.Default,
      Layer.succeed(OutboxStore, store),
    ]),
    Layer.provide([
      LinkstrIdentity.fromSecretKey(identity.secretKey),
      RelayPolicy.fixed({ readRelays: [relay], writeRelays: [relay] }),
      transport,
    ]),
  );

const runOutbox = <A>(
  layer: Layer.Layer<Outbox>,
  program: Effect.Effect<A, never, Outbox>,
): Promise<A> => Effect.runPromise(program.pipe(Effect.provide(layer)));

const textOp = (
  content: string,
  options?: { readonly clientId?: ClientId; readonly sentAt?: UnixSeconds },
): RumorFixedOperation => ({
  _tag: "chat.text",
  draft: new TextMessageDraft({
    to: bob.pubkey,
    content: MessageText.make(content),
    ...(options?.clientId === undefined ? {} : { clientId: options.clientId }),
    ...(options?.sentAt === undefined ? {} : { sentAt: options.sentAt }),
  }),
});

const reactionOp = (): RumorFixedOperation => ({
  _tag: "reaction",
  draft: new ReactionDraft({
    to: bob.pubkey,
    target: RumorId.make("ab".repeat(32)),
    targetKind: "text",
    targetAuthor: bob.pubkey,
    emoji: Emoji.make("🔥"),
  }),
});

const telemetryDraft = (id: string): PaymentTelemetryDraft =>
  new PaymentTelemetryDraft({
    id: ClientId.make(id),
    createdAtSec: UnixSeconds.make(1_700_000_000),
    direction: "out",
    status: "ok",
    method: "lightning_invoice",
    phase: "complete",
    mint: null,
    amountBucket: "lte_100",
    feeBucket: null,
    errorCode: null,
    errorDetail: null,
    appHost: null,
    devicePlatform: null,
    appRuntime: null,
    appVersion: "26.9.0",
  });

const rumorsForBob = (published: ReadonlyArray<SignedWrapEvent>) =>
  published
    .filter((wrap) => recipientOf(wrap) === bob.pubkey)
    .map((wrap) => Either.getOrThrow(unwrapToRumor(wrap, bob.secretKey)));

describe("Outbox", () => {
  it("returns a deterministic rumorId equal to the delivered rumor id", async () => {
    const published: Array<SignedWrapEvent> = [];
    const store = makeStore();
    const clientId = ClientId.make("client-outbox");
    const sentAt = UnixSeconds.make(1_700_000_000);

    const { receipt, result } = await runOutbox(
      outboxLayer(alice, store, stubTransport(published, { accept: true })),
      Effect.gen(function* () {
        const outbox = yield* Outbox;
        const receipt = yield* outbox.enqueue(
          textOp("hello", { clientId, sentAt }),
          OutboxRef.make("row-1"),
        );
        const result = yield* Stream.runHead(outbox.results);
        return { receipt, result };
      }),
    );

    expect(receipt.clientId).toBe(clientId);
    expect(receipt.sentAt).toBe(sentAt);
    const terminal = Option.getOrThrow(result);
    assert(terminal._tag === "OutboxJobSucceeded");
    expect(terminal.jobId).toBe(receipt.jobId);
    expect(terminal.ref).toBe("row-1");
    assert(terminal.receipt instanceof ChatMessageReceipt);
    expect(terminal.receipt.rumorId).toBe(receipt.rumorId);
    expect(terminal.receipt.clientId).toBe(clientId);
    expect(terminal.receipt.sentAt).toBe(sentAt);

    const rumors = rumorsForBob(published);
    expect(rumors).toHaveLength(1);
    expect(rumors[0]?.id).toBe(receipt.rumorId);
    expect(rumors[0]?.created_at).toBe(sentAt);
  });

  it("retries invisibly until the transport recovers, one terminal per job", async () => {
    const published: Array<SignedWrapEvent> = [];
    const behavior = { accept: false };
    const store = makeStore();

    const { first, second, results, stored } = await runOutbox(
      outboxLayer(alice, store, stubTransport(published, behavior)),
      Effect.gen(function* () {
        const outbox = yield* Outbox;
        const first = yield* outbox.enqueue(
          textOp("first"),
          OutboxRef.make("row-1"),
        );
        // Both copies of the first attempt are published and rejected.
        yield* eventually(() => published.length >= 2);
        behavior.accept = true;
        // A new enqueue cuts the backoff sleep short.
        const second = yield* outbox.enqueue(
          textOp("second"),
          OutboxRef.make("row-2"),
        );
        const results = yield* outbox.results.pipe(
          Stream.take(2),
          Stream.runCollect,
          Effect.map(Chunk.toReadonlyArray),
        );
        const stored = yield* store.loadAll;
        return { first, second, results, stored };
      }),
    );

    expect(results.map((result) => result.ref)).toEqual(["row-1", "row-2"]);
    expect(results.every((r) => r._tag === "OutboxJobSucceeded")).toBe(true);
    expect(second.rumorId).not.toBe(first.rumorId);

    // Every retry published the identical precomputed rumor.
    const firstRumors = rumorsForBob(published).filter(
      (rumor) => rumor.content === "first",
    );
    expect(firstRumors.length).toBeGreaterThanOrEqual(2);
    for (const rumor of firstRumors) {
      expect(rumor.id).toBe(first.rumorId);
      expect(rumor.created_at).toBe(first.sentAt);
    }
    expect(stored.every((job) => job.state._tag === "awaiting-ack")).toBe(true);
  });

  it("re-emits unacked terminals on rebuild and forgets them after ack", async () => {
    const published: Array<SignedWrapEvent> = [];
    const store = makeStore();
    const transport = stubTransport(published, { accept: true });

    const receipt = await runOutbox(
      outboxLayer(alice, store, transport),
      Effect.gen(function* () {
        const outbox = yield* Outbox;
        const receipt = yield* outbox.enqueue(
          textOp("hello"),
          OutboxRef.make("row-1"),
        );
        yield* Stream.runHead(outbox.results); // delivered, deliberately not acked
        return receipt;
      }),
    );

    const replayed = await runOutbox(
      outboxLayer(alice, store, transport),
      Effect.gen(function* () {
        const outbox = yield* Outbox;
        const replayed = yield* Stream.runHead(outbox.results);
        yield* outbox.ack(receipt.jobId);
        return replayed;
      }),
    );

    const terminal = Option.getOrThrow(replayed);
    expect(terminal._tag).toBe("OutboxJobSucceeded");
    expect(terminal.jobId).toBe(receipt.jobId);
    expect(published).toHaveLength(2); // the replay did not re-send anything
    expect(await Effect.runPromise(store.loadAll)).toEqual([]);

    const afterAck = await runOutbox(
      outboxLayer(alice, store, transport),
      Effect.gen(function* () {
        const outbox = yield* Outbox;
        return yield* Stream.runHead(outbox.results).pipe(
          Effect.timeout(100),
          Effect.option,
        );
      }),
    );
    expect(Option.isNone(afterAck)).toBe(true);
  });

  it("fails jobs enqueued under a different identity", async () => {
    const store = makeStore();
    const rejecting = stubTransport([], { accept: false });

    const receipt = await runOutbox(
      outboxLayer(alice, store, rejecting),
      Effect.gen(function* () {
        const outbox = yield* Outbox;
        return yield* outbox.enqueue(
          textOp("stranded"),
          OutboxRef.make("row-1"),
        );
      }),
    );

    const result = await runOutbox(
      outboxLayer(bob, store, rejecting),
      Effect.gen(function* () {
        const outbox = yield* Outbox;
        return yield* Stream.runHead(outbox.results);
      }),
    );

    expect(Option.getOrThrow(result)).toEqual(
      expect.objectContaining({
        _tag: "OutboxJobFailed",
        jobId: receipt.jobId,
        ref: "row-1",
        reason: "identity-changed",
      }),
    );
  });

  it("processes queued jobs strictly FIFO across operation types", async () => {
    const published: Array<SignedWrapEvent> = [];
    const store = makeStore();

    const { receipts, results } = await runOutbox(
      outboxLayer(alice, store, stubTransport(published, { accept: true })),
      Effect.gen(function* () {
        const outbox = yield* Outbox;
        const receipts = [
          yield* outbox.enqueue(textOp("one"), OutboxRef.make("row-1")),
          yield* outbox.enqueue(reactionOp(), OutboxRef.make("row-2")),
          yield* outbox.enqueue(textOp("three"), OutboxRef.make("row-3")),
        ];
        const results = yield* outbox.results.pipe(
          Stream.take(3),
          Stream.runCollect,
          Effect.map(Chunk.toReadonlyArray),
        );
        return { receipts, results };
      }),
    );

    expect(results.map((result) => result.ref)).toEqual([
      "row-1",
      "row-2",
      "row-3",
    ]);
    const reaction = results[1];
    assert(reaction?._tag === "OutboxJobSucceeded");
    assert(reaction.receipt instanceof ReactionReceipt);
    expect(reaction.receipt.rumorId).toBe(receipts[1]?.rumorId);
  });

  it("delivers payment telemetry and forgets the job once acked", async () => {
    const published: Array<SignedWrapEvent> = [];
    const store = makeStore();

    const { jobId, result } = await runOutbox(
      outboxLayer(alice, store, stubTransport(published, { accept: true })),
      Effect.gen(function* () {
        const outbox = yield* Outbox;
        const jobId = yield* outbox.enqueueTelemetry(
          telemetryDraft("telemetry-1"),
          bob.pubkey,
          OutboxRef.make("telemetry:1"),
        );
        const result = yield* Stream.runHead(outbox.results);
        yield* outbox.ack(jobId);
        return { jobId, result };
      }),
    );

    const terminal = Option.getOrThrow(result);
    assert(terminal._tag === "OutboxJobSucceeded");
    expect(terminal.jobId).toBe(jobId);
    expect(terminal.ref).toBe("telemetry:1");
    assert(terminal.receipt instanceof PaymentTelemetryReceipt);
    expect(terminal.receipt.clientId).toBe("telemetry-1");

    // Telemetry has no self copy: one wrap, and it is not signed by alice.
    expect(published).toHaveLength(1);
    const rumors = rumorsForBob(published);
    expect(rumors).toHaveLength(1);
    expect(rumors[0]?.pubkey).not.toBe(alice.pubkey);
    expect(await Effect.runPromise(store.loadAll)).toEqual([]);
  });

  it("retries undelivered telemetry, minting a fresh rumor per attempt", async () => {
    const published: Array<SignedWrapEvent> = [];
    const behavior = { accept: false };
    const store = makeStore();

    const results = await runOutbox(
      outboxLayer(alice, store, stubTransport(published, behavior)),
      Effect.gen(function* () {
        const outbox = yield* Outbox;
        yield* outbox.enqueueTelemetry(
          telemetryDraft("telemetry-1"),
          bob.pubkey,
          OutboxRef.make("telemetry:1"),
        );
        yield* eventually(() => published.length >= 1);
        behavior.accept = true;
        // A new enqueue cuts the backoff sleep short.
        yield* outbox.enqueueTelemetry(
          telemetryDraft("telemetry-2"),
          bob.pubkey,
          OutboxRef.make("telemetry:2"),
        );
        return yield* outbox.results.pipe(
          Stream.take(2),
          Stream.runCollect,
          Effect.map(Chunk.toReadonlyArray),
        );
      }),
    );

    expect(results.map((result) => result.ref)).toEqual([
      "telemetry:1",
      "telemetry:2",
    ]);
    expect(
      results.every((result) => result._tag === "OutboxJobSucceeded"),
    ).toBe(true);

    const firstRumors = rumorsForBob(published).filter((rumor) =>
      rumor.content.includes("telemetry-1"),
    );
    expect(firstRumors.length).toBeGreaterThanOrEqual(2);
    expect(new Set(firstRumors.map((rumor) => rumor.id)).size).toBe(
      firstRumors.length,
    );
  });
});
