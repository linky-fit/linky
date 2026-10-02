import { Effect, Exit, Layer } from "effect";
import { finalizeEvent, verifyEvent } from "nostr-tools";
import { RelayUrl } from "../domain/primitives";
import { tagValues } from "../internal/nostrEvent";
import type { SignedPlainEvent } from "../internal/nostrEvent";
import { LinkstrIdentity } from "../services/LinkstrIdentity";
import {
  RelayUnreachable,
  type NostrTransport,
} from "../services/NostrTransport";
import { RelayPolicy } from "../services/RelayPolicy";
import { makeIdentity, stubPlainTransport } from "../testing";
import { MuteList } from "./MuteList";

const alice = makeIdentity();
const bob = makeIdentity();
const carol = makeIdentity();

const relayA = RelayUrl.make("wss://relay-a.test");
const relayB = RelayUrl.make("wss://relay-b.test");

const runWith = <A, E>(
  transport: Layer.Layer<NostrTransport>,
  program: Effect.Effect<A, E, MuteList>,
  readRelays: ReadonlyArray<RelayUrl> = [relayA],
): Promise<Exit.Exit<A, E>> =>
  Effect.runPromiseExit(
    program.pipe(
      Effect.provide(
        MuteList.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              LinkstrIdentity.fromSecretKey(alice.secretKey),
              RelayPolicy.fixed({
                readRelays,
                writeRelays: [relayA],
              }),
              transport,
            ),
          ),
        ),
      ),
    ),
  );

describe("MuteList.publishMuteList", () => {
  it("publishes a signed kind 10000 with p tags and empty content", async () => {
    const published: Array<SignedPlainEvent> = [];
    const exit = await runWith(
      stubPlainTransport(published),
      Effect.flatMap(MuteList, (muteList) =>
        muteList.publishMuteList([bob.pubkey, carol.pubkey]),
      ),
    );

    assert(Exit.isSuccess(exit));
    const event = published[0];
    assert(event !== undefined);
    expect(event.kind).toBe(10000);
    expect(event.content).toBe("");
    expect(verifyEvent(event)).toBe(true);
    expect(tagValues(event.tags, "p")).toEqual([bob.pubkey, carol.pubkey]);
    expect(exit.value.eventId).toBe(event.id);
    expect(exit.value.results).toEqual([
      expect.objectContaining({ relay: relayA, accepted: true }),
    ]);
  });

  it("fails with NoRelayAcceptedEvent when no relay accepts", async () => {
    const exit = await runWith(
      stubPlainTransport([], () => false),
      Effect.flatMap(MuteList, (muteList) =>
        muteList.publishMuteList([bob.pubkey]),
      ),
    );

    expect(exit).toEqual(
      Exit.fail(
        expect.objectContaining({ _tag: "NoRelayAcceptedEvent", kind: 10000 }),
      ),
    );
  });
});

describe("MuteList.fetchOwnMuteList", () => {
  const muteList = (pubkeys: ReadonlyArray<string>, createdAt: number) =>
    finalizeEvent(
      {
        kind: 10000,
        tags: pubkeys.map((pubkey) => ["p", pubkey]),
        content: "",
        created_at: createdAt,
      },
      alice.secretKey,
    );

  it("returns the newest list's valid p entries and its time", async () => {
    const asked: Array<string> = [];
    const exit = await runWith(
      stubPlainTransport([], () => true, {
        fetch: (relay) =>
          Effect.sync(() => {
            asked.push(relay);
            return [
              muteList([bob.pubkey], 100),
              muteList([carol.pubkey, carol.pubkey, "not-a-pubkey"], 200),
            ];
          }),
      }),
      Effect.flatMap(MuteList, (muteList) => muteList.fetchOwnMuteList()),
    );
    assert(Exit.isSuccess(exit));
    expect(exit.value?.pubkeys).toEqual([carol.pubkey]);
    expect(exit.value?.createdAt).toBe(200);
    expect(exit.value?.eventId).toMatch(/^[0-9a-f]{64}$/);
    expect(asked).toEqual([relayA]);
  });

  it("returns null when no relay holds a list", async () => {
    const exit = await runWith(
      stubPlainTransport([], () => true, { fetch: () => Effect.succeed([]) }),
      Effect.flatMap(MuteList, (muteList) => muteList.fetchOwnMuteList()),
    );
    expect(exit).toEqual(Exit.succeed(null));
  });

  const relayBSilent = (events: ReturnType<typeof muteList>[]) =>
    stubPlainTransport([], () => true, {
      fetch: (relay) =>
        relay === relayB
          ? Effect.fail(new RelayUnreachable({ relay, detail: "timed out" }))
          : Effect.succeed(events),
    });

  it("cannot tell there is no list while a relay did not answer", async () => {
    const exit = await runWith(
      relayBSilent([]),
      Effect.flatMap(MuteList, (muteList) => muteList.fetchOwnMuteList()),
      [relayA, relayB],
    );
    expect(exit).toEqual(
      Exit.fail(
        expect.objectContaining({
          _tag: "SomeRelaysUnanswered",
          failures: [expect.objectContaining({ relay: relayB })],
        }),
      ),
    );
  });

  it("returns a list one relay holds while another did not answer", async () => {
    const exit = await runWith(
      relayBSilent([muteList([bob.pubkey], 100)]),
      Effect.flatMap(MuteList, (muteList) => muteList.fetchOwnMuteList()),
      [relayA, relayB],
    );
    assert(Exit.isSuccess(exit));
    expect(exit.value?.pubkeys).toEqual([bob.pubkey]);
  });
});
