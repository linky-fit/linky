import {
  DevicePairing,
  makeNostrTransportSimplePool,
} from "@linky-fit/linkstr";
import { Effect, Layer, ManagedRuntime } from "effect";
import { appConfig } from "../config";

// Its own relay pool, since a device joining has no account and so no linkstr runtime.
const runtime = ManagedRuntime.make(
  DevicePairing.layer.pipe(
    Layer.provide(
      makeNostrTransportSimplePool({
        allowInsecureLocalhost: appConfig.allowInsecureLocalhostRelays,
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
export const pairingRelays = () => appConfig.nostrRelays.slice(0, 2);
