import { Clock, Effect } from "effect";

export const nowSeconds: Effect.Effect<number> = Effect.map(
  Clock.currentTimeMillis,
  (millis) => Math.floor(millis / 1000),
);
