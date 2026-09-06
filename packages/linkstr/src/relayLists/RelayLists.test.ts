import { Effect, Exit, Layer } from "effect";
import { finalizeEvent } from "nostr-tools";
import type { Event as NostrToolsEvent } from "nostr-tools";
import { RelayUrl } from "../domain/primitives";
import type { SignedPlainEvent } from "../internal/nostrEvent";
import { LinkstrIdentity } from "../services/LinkstrIdentity";
import type { NostrTransport } from "../services/NostrTransport";
import { RelayPolicy } from "../services/RelayPolicy";
import { makeIdentity, stubPlainTransport } from "../testing";
import { RelayListEntry, RelayListsDraft } from "./domain";
import { RelayLists } from "./RelayLists";

const alice = makeIdentity();

const relayA = RelayUrl.make("wss://relay-a.test");
const relayOne = RelayUrl.make("wss://one.test");
const relayTwo = RelayUrl.make("wss://two.test");
const relayDm = RelayUrl.make("wss://dm.test");

const base = 1_754_000_000;

const stubTransport = (
  published: Array<SignedPlainEvent>,
  options?: {
    accept?: (event: SignedPlainEvent) => boolean;
    stored?: ReadonlyArray<NostrToolsEvent>;
  },
): Layer.Layer<NostrTransport> =>
  stubPlainTransport(published, options?.accept ?? (() => true), {
    fetch: () => Effect.succeed(options?.stored ?? []),
  });

const runWith = <A, E>(
  transport: Layer.Layer<NostrTransport>,
  program: Effect.Effect<A, E, RelayLists>,
): Promise<Exit.Exit<A, E>> =>
  Effect.runPromiseExit(
    program.pipe(
      Effect.provide(
        RelayLists.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              LinkstrIdentity.fromSecretKey(alice.secretKey),
              RelayPolicy.fixed({
                readRelays: [relayA],
                writeRelays: [relayA],
              }),
              transport,
            ),
          ),
        ),
      ),
    ),
  );

const draft = new RelayListsDraft({
  relays: [
    new RelayListEntry({ relay: relayOne, marker: "read" }),
    new RelayListEntry({ relay: relayTwo, marker: null }),
  ],
  dmRelays: [relayDm],
});

describe("RelayLists.publishRelayLists", () => {
  it("publishes kind 10002 and 10050 as one operation with per-event receipts", async () => {
    const published: Array<SignedPlainEvent> = [];
    const exit = await runWith(
      stubTransport(published),
      Effect.flatMap(RelayLists, (relayLists) =>
        relayLists.publishRelayLists(draft),
      ),
    );

    assert(Exit.isSuccess(exit));

    const relayList = published.find((event) => event.kind === 10002);
    const dmRelayList = published.find((event) => event.kind === 10050);
    expect(relayList?.tags).toEqual([
      ["r", relayOne, "read"],
      ["r", relayTwo],
    ]);
    expect(relayList?.content).toBe("");
    expect(dmRelayList?.tags).toEqual([["relay", relayDm]]);
    expect(dmRelayList?.content).toBe("");

    expect(exit.value.relayList.eventId).toBe(relayList?.id);
    expect(exit.value.relayList.kind).toBe(10002);
    expect(exit.value.dmRelayList.eventId).toBe(dmRelayList?.id);
    expect(exit.value.dmRelayList.kind).toBe(10050);
  });

  it("fails with NoRelayAcceptedEvent naming the rejected kind", async () => {
    const exit = await runWith(
      stubTransport([], { accept: (event) => event.kind !== 10050 }),
      Effect.flatMap(RelayLists, (relayLists) =>
        relayLists.publishRelayLists(draft),
      ),
    );

    expect(exit).toEqual(
      Exit.fail(
        expect.objectContaining({
          _tag: "NoRelayAcceptedEvent",
          kind: 10050,
        }),
      ),
    );
  });
});

describe("RelayLists.fetchOwnRelayLists", () => {
  it("returns the newest list per kind with tolerant entry decoding", async () => {
    const stored = [
      finalizeEvent(
        {
          kind: 10002,
          tags: [
            ["r", relayOne, "read"],
            ["r", relayTwo],
            ["r", relayDm, "banana"],
            ["r", "not-a-relay-url"],
            ["e", "unrelated"],
          ],
          content: "",
          created_at: base + 10,
        },
        alice.secretKey,
      ),
      finalizeEvent(
        {
          kind: 10002,
          tags: [["r", relayOne]],
          content: "",
          created_at: base + 5,
        },
        alice.secretKey,
      ),
      finalizeEvent(
        {
          kind: 10050,
          tags: [
            ["relay", relayDm],
            ["relay", "nope"],
          ],
          content: "",
          created_at: base + 7,
        },
        alice.secretKey,
      ),
    ];

    const exit = await runWith(
      stubTransport([], { stored }),
      Effect.flatMap(RelayLists, (relayLists) =>
        relayLists.fetchOwnRelayLists(),
      ),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.relays).toEqual([
      expect.objectContaining({ relay: relayOne, marker: "read" }),
      expect.objectContaining({ relay: relayTwo, marker: null }),
      // Unknown markers degrade to null rather than dropping the relay.
      expect.objectContaining({ relay: relayDm, marker: null }),
    ]);
    expect(exit.value.relaysUpdatedAt).toBe(base + 10);
    expect(exit.value.dmRelays).toEqual([relayDm]);
    expect(exit.value.dmRelaysUpdatedAt).toBe(base + 7);
  });

  it("returns nulls for kinds with no stored event", async () => {
    const exit = await runWith(
      stubTransport([], { stored: [] }),
      Effect.flatMap(RelayLists, (relayLists) =>
        relayLists.fetchOwnRelayLists(),
      ),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value).toEqual(
      expect.objectContaining({
        relays: null,
        relaysUpdatedAt: null,
        dmRelays: null,
        dmRelaysUpdatedAt: null,
      }),
    );
  });
});
