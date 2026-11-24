import { Effect, Layer } from "effect";
import type { Event as NostrToolsEvent, Filter } from "nostr-tools";
import { describe, expect, it, vi } from "vitest";
import { Schema } from "effect";
import { RelayUrl } from "../domain/primitives";
import type { SignedPlainEvent, SignedWrapEvent } from "../internal/nostrEvent";
import { NostrTransport, RelayPublishResult } from "../services/NostrTransport";
import { parsePairingInvite, type PairingPayload } from "./codec";
import {
  DevicePairing,
  type PairingJoinState,
  type PairingOfferState,
} from "./DevicePairing";

/** One relay that forwards every event to the open subscriptions it matches. */
const loopbackTransport = () => {
  const subscribers = new Set<{
    readonly pubkeys: ReadonlyArray<string>;
    readonly onEvent: (event: NostrToolsEvent) => void;
  }>();
  const deliver = (event: SignedPlainEvent | SignedWrapEvent) => {
    const to = event.tags.find((tag) => tag[0] === "p")?.[1];
    const raw = { ...event, tags: event.tags.map((tag) => [...tag]) };
    for (const subscriber of subscribers)
      if (to !== undefined && subscriber.pubkeys.includes(to))
        queueMicrotask(() => subscriber.onEvent(raw));
  };
  const layer = Layer.succeed(NostrTransport, {
    publish: (relays, event) =>
      Effect.sync(() => {
        deliver(event);
        return relays.map(
          (relay) =>
            new RelayPublishResult({ relay, accepted: true, detail: null }),
        );
      }),
    subscribe: (_relay, filters: ReadonlyArray<Filter>, onEvent) =>
      Effect.callback<string>(() => {
        const subscriber = { pubkeys: filters[0]?.["#p"] ?? [], onEvent };
        subscribers.add(subscriber);
        return Effect.sync(() => subscribers.delete(subscriber));
      }),
    fetch: () => Effect.succeed([]),
  });
  return { layer };
};

const pairingWith = (transport: ReturnType<typeof loopbackTransport>) =>
  Effect.runSync(
    Effect.gen(function* () {
      return yield* DevicePairing;
    }).pipe(
      Effect.provide(DevicePairing.layer.pipe(Layer.provide(transport.layer))),
    ),
  );

const relays = [Schema.decodeSync(RelayUrl)("wss://relay.one")];
const payload: PairingPayload = {
  masterKey: "00112233445566778899aabbccddeeff",
  accountName: "Hynek",
  transports: ["wss://sync.one", "wss://sync.one"],
};

const startOffer = (pairing: ReturnType<typeof pairingWith>) => {
  const states: Array<PairingOfferState> = [];
  const session = pairing.offer({
    payload,
    relays,
    onState: (state) => states.push(state),
  });
  const first = states[0];
  if (first?.phase !== "waiting") throw new Error("no invite");
  const invite = parsePairingInvite(first.invite);
  if (invite === null) throw new Error("unreadable invite");
  return { session, states, invite };
};

const startJoin = (
  pairing: ReturnType<typeof pairingWith>,
  invite: NonNullable<ReturnType<typeof parsePairingInvite>>,
) => {
  const states: Array<PairingJoinState> = [];
  const session = pairing.join({
    invite,
    deviceId: "joining-device",
    onState: (state) => states.push(state),
  });
  const code = async () => {
    await vi.waitFor(() => expect(states.at(-1)?.phase).toBe("code"));
    const last = states.at(-1);
    return last?.phase === "code" ? last.code : "";
  };
  return { session, states, code };
};

describe("DevicePairing", () => {
  it("sends the payload to the device whose code was typed", async () => {
    const pairing = pairingWith(loopbackTransport());
    const offer = startOffer(pairing);
    const join = startJoin(pairing, offer.invite);
    const code = await join.code();
    expect(offer.states.at(-1)).toMatchObject({ phase: "locked" });

    offer.session.submitCode(`${code.slice(0, 3)} ${code.slice(3)}`);

    await vi.waitFor(() =>
      expect(join.states.at(-1)).toEqual({
        phase: "received",
        payload: { ...payload, transports: ["wss://sync.one"] },
      }),
    );
    await vi.waitFor(() =>
      expect(offer.states.at(-1)).toEqual({
        phase: "done",
        acked: true,
        deviceId: "joining-device",
      }),
    );
  });

  it("three wrong codes end the session without a payload", async () => {
    const transport = loopbackTransport();
    const pairing = pairingWith(transport);
    const offer = startOffer(pairing);
    const join = startJoin(pairing, offer.invite);
    const code = await join.code();
    const wrong = code === "000000" ? "111111" : "000000";

    offer.session.submitCode(wrong);
    expect(offer.states.at(-1)).toMatchObject({
      phase: "locked",
      attemptsLeft: 2,
      mismatch: true,
    });
    offer.session.submitCode(wrong);
    offer.session.submitCode(wrong);

    expect(offer.states.at(-1)).toEqual({
      phase: "failed",
      reason: "codeMismatch",
    });
    await vi.waitFor(() =>
      expect(join.states.at(-1)).toEqual({
        phase: "failed",
        reason: "codeMismatch",
      }),
    );
    expect(join.states.some((state) => state.phase === "received")).toBe(false);
  });

  it("a second device answering the invite aborts both", async () => {
    const pairing = pairingWith(loopbackTransport());
    const offer = startOffer(pairing);
    const first = startJoin(pairing, offer.invite);
    await first.code();
    const second = startJoin(pairing, offer.invite);

    await vi.waitFor(() =>
      expect(offer.states.at(-1)).toEqual({
        phase: "failed",
        reason: "conflict",
      }),
    );
    await vi.waitFor(() =>
      expect(first.states.at(-1)).toEqual({
        phase: "failed",
        reason: "conflict",
      }),
    );
    expect(second.states.at(-1)?.phase).not.toBe("code");
  });

  it("a hello without the session secret neither locks nor conflicts", async () => {
    const pairing = pairingWith(loopbackTransport());
    const offer = startOffer(pairing);
    startJoin(pairing, { ...offer.invite, s: "ff".repeat(16) });
    const join = startJoin(pairing, offer.invite);
    await join.code();
    expect(offer.states.at(-1)).toMatchObject({ phase: "locked" });
  });

  it("cancelling on the joining device ends the offer", async () => {
    const pairing = pairingWith(loopbackTransport());
    const offer = startOffer(pairing);
    const join = startJoin(pairing, offer.invite);
    await join.code();

    join.session.cancel();

    await vi.waitFor(() =>
      expect(offer.states.at(-1)).toEqual({
        phase: "failed",
        reason: "cancelled",
      }),
    );
  });
});
