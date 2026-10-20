import { Deferred, Effect, Exit, Fiber, Layer, Stream } from "effect";
import type { Scope } from "effect";
import { RelayUrl, UnixSeconds } from "../domain/primitives";
import { signPlainEvent } from "../internal/plainEvent";
import { LinkstrIdentity } from "../services/LinkstrIdentity";
import { NostrTransport, RelayPublishResult } from "../services/NostrTransport";
import { RelayPolicy } from "../services/RelayPolicy";
import { makeIdentity, stubPlainTransport } from "../testing";
import type { SignedPlainEvent } from "../testing";
import { AppData } from "./AppData";
import { AppDataDraft, AppDataIdentifier, AppDataQuery } from "./domain";

const device = makeIdentity();
const employee = makeIdentity();
const stranger = makeIdentity();
const relay = RelayUrl.make("wss://relay.test");
const identifier = AppDataIdentifier.make("platitprosim:employee-device");

const runWith = <A, E>(
  transport: Layer.Layer<NostrTransport>,
  program: Effect.Effect<A, E, AppData | Scope.Scope>,
): Promise<Exit.Exit<A, E>> =>
  Effect.runPromiseExit(
    Effect.scoped(
      program.pipe(
        Effect.provide(
          AppData.layer.pipe(
            Layer.provide(
              Layer.mergeAll(
                LinkstrIdentity.fromSecretKey(device.secretKey),
                RelayPolicy.fixed({
                  readRelays: [relay],
                  writeRelays: [relay],
                }),
                transport,
              ),
            ),
          ),
        ),
      ),
    ),
  );

const appDataEvent = (
  author: typeof device,
  createdAt: number,
  content: string,
  d: string = identifier,
): SignedPlainEvent =>
  signPlainEvent(
    {
      kind: 30078,
      tags: [
        ["d", d],
        ["p", employee.pubkey],
      ],
      content,
    },
    UnixSeconds.make(createdAt),
    author.secretKey,
  );

const byEmployee = new AppDataQuery({
  identifiers: [identifier],
  taggedPubkeys: [employee.pubkey],
});

describe("AppData.publish", () => {
  it("signs one kind 30078 event with the d tag first", async () => {
    const published: Array<SignedPlainEvent> = [];
    const exit = await runWith(
      stubPlainTransport(published),
      Effect.flatMap(AppData, (appData) =>
        appData.publish(
          new AppDataDraft({
            identifier,
            tags: [["p", employee.pubkey]],
            content: "attestation",
          }),
        ),
      ),
    );

    assert(Exit.isSuccess(exit));
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      id: exit.value.eventId,
      kind: 30078,
      pubkey: device.pubkey,
      tags: [
        ["d", identifier],
        ["p", employee.pubkey],
      ],
      content: "attestation",
    });
  });

  it("orders rapid publications within each slot", async () => {
    const published: Array<SignedPlainEvent> = [];
    const exit = await runWith(
      stubPlainTransport(published),
      Effect.gen(function* () {
        const appData = yield* AppData;
        yield* Effect.all(
          ["first", "second", "third"].map((content) =>
            appData.publish(new AppDataDraft({ identifier, content })),
          ),
          { concurrency: "unbounded" },
        );
      }),
    );
    assert(Exit.isSuccess(exit));
    expect(published).toHaveLength(3);
    expect(published[1]?.created_at).toBe((published[0]?.created_at ?? 0) + 1);
    expect(published[2]?.created_at).toBe((published[1]?.created_at ?? 0) + 1);
  });

  it("does not hold one slot's publication behind another slot's", async () => {
    const stalled = AppDataIdentifier.make("platitprosim:stalled");
    const started = Effect.runSync(Deferred.make<void>());
    const release = Effect.runSync(Deferred.make<void>());
    const published: Array<string> = [];
    const transport = Layer.succeed(NostrTransport, {
      publish: (relays, event) =>
        Effect.gen(function* () {
          const d = event.tags[0]?.[1] ?? "";
          if (d === stalled) {
            yield* Deferred.succeed(started, undefined);
            yield* Deferred.await(release);
          }
          published.push(d);
          return relays.map(
            (to) =>
              new RelayPublishResult({
                relay: to,
                accepted: true,
                detail: null,
              }),
          );
        }),
      subscribe: () => Effect.die("subscribe not under test"),
      fetch: () => Effect.die("fetch not under test"),
    });
    const exit = await runWith(
      transport,
      Effect.gen(function* () {
        const appData = yield* AppData;
        const first = yield* Effect.forkChild(
          appData.publish(
            new AppDataDraft({ identifier: stalled, content: "a" }),
          ),
        );
        yield* Deferred.await(started);
        yield* appData.publish(new AppDataDraft({ identifier, content: "b" }));
        expect(published).toEqual([identifier]);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(first);
      }),
    );
    assert(Exit.isSuccess(exit));
    expect(published).toEqual([identifier, stalled]);
  });

  it("refuses a draft that brings its own d tag", () => {
    expect(
      () =>
        new AppDataDraft({ identifier, tags: [["d", "other"]], content: "" }),
    ).toThrow();
  });
});

describe("AppData.fetch", () => {
  it("returns each author's newest event per d tag and drops what the query did not ask for", async () => {
    const events = [
      appDataEvent(device, 1_700_000_000, "old"),
      appDataEvent(device, 1_700_000_100, "new"),
      appDataEvent(stranger, 1_700_000_050, "other device"),
      appDataEvent(stranger, 1_700_000_060, "foreign slot", "unrelated"),
    ];
    const exit = await runWith(
      stubPlainTransport([], () => true, {
        fetch: () => Effect.succeed(events),
      }),
      Effect.flatMap(AppData, (appData) => appData.fetch(byEmployee)),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.map((event) => [event.author, event.content])).toEqual([
      [device.pubkey, "new"],
      [stranger.pubkey, "other device"],
    ]);
    expect(exit.value[0]?.event.sig).toBe(events[1]?.sig);
  });
});

describe("AppData.watch", () => {
  it("streams verified matching events, skipping versions older than one already seen", async () => {
    const forged = {
      ...appDataEvent(device, 1_700_000_300, "x"),
      sig: "00".repeat(64),
    };
    const events = [
      appDataEvent(device, 1_700_000_100, "first"),
      appDataEvent(device, 1_700_000_000, "stale"),
      forged,
      appDataEvent(device, 1_700_000_200, "second"),
    ];
    const exit = await runWith(
      stubPlainTransport([], () => true, {
        subscribe: (_relay, _filter, onEvent) =>
          Effect.sync(() => events.forEach(onEvent)).pipe(
            Effect.andThen(Effect.never),
          ),
      }),
      Effect.gen(function* () {
        const appData = yield* AppData;
        const stream = yield* appData.watch(byEmployee);
        return yield* Stream.runCollect(Stream.take(stream, 2));
      }),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.map((event) => event.content)).toEqual([
      "first",
      "second",
    ]);
  });
});
