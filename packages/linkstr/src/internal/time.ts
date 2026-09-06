import { Clock, Effect } from "effect";
import { UnixSeconds } from "../domain/primitives";

export const nowSeconds: Effect.Effect<UnixSeconds> = Effect.map(
  Clock.currentTimeMillis,
  (millis) => UnixSeconds.make(Math.floor(millis / 1000)),
);
