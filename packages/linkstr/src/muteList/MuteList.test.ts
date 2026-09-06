import { Effect, Exit, Layer } from "effect";
import { verifyEvent } from "nostr-tools";
import { RelayUrl } from "../domain/primitives";
import { tagValues } from "../internal/nostrEvent";
import type { SignedPlainEvent } from "../internal/nostrEvent";
import { LinkstrIdentity } from "../services/LinkstrIdentity";
import type { NostrTransport } from "../services/NostrTransport";
import { RelayPolicy } from "../services/RelayPolicy";
import { makeIdentity, stubPlainTransport } from "../testing";
import { MuteList } from "./MuteList";

const alice = makeIdentity();
const bob = makeIdentity();
const carol = makeIdentity();

const relayA = RelayUrl.make("wss://relay-a.test");

const runWith = <A, E>(
  transport: Layer.Layer<NostrTransport>,
  program: Effect.Effect<A, E, MuteList>,
): Promise<Exit.Exit<A, E>> =>
  Effect.runPromiseExit(
    program.pipe(
      Effect.provide(
        MuteList.Default.pipe(
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
