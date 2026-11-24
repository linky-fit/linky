import {
  DevicePairing,
  makeNostrTransportSimplePool,
  type RelayUrl,
} from "@linky-fit/linkstr";
import { Effect, Layer, ManagedRuntime } from "effect";
import {
  ALLOW_INSECURE_LOCALHOST_RELAYS,
  recommendedNostrRelays,
} from "../../utils/nostrRelays";

// Its own relay pool, since a device joining has no account and so no linkstr runtime.
const runtime = ManagedRuntime.make(
  DevicePairing.layer.pipe(
    Layer.provide(
      makeNostrTransportSimplePool({
        allowInsecureLocalhost: ALLOW_INSECURE_LOCALHOST_RELAYS,
      }),
    ),
  ),
);

/** Moves the recovery seed to a new device by QR code; see linkstr's device pairing guide. */
export const loadDevicePairing = () =>
  runtime.runPromise(
    Effect.gen(function* () {
      return yield* DevicePairing;
    }),
  );

/** The relays an invite names; the joining device answers on them. */
export const pairingRelays = (): ReadonlyArray<RelayUrl> =>
  recommendedNostrRelays().slice(0, 2);
