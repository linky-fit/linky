import { RelayHealth } from "@linky-fit/linkstr";
import type { RelayHealthState } from "@linky-fit/linkstr";
import { Effect, Stream } from "effect";
import { linkstrRuntimeAtom } from "./runtime";

/**
 * Latest per-relay health snapshot, keyed by plain relay url string. Emits
 * the current snapshot on mount, then every change; resets when the runtime
 * is rebuilt (identity or relay-set switch).
 */
export const relayHealthAtom = linkstrRuntimeAtom.atom(() =>
  Stream.unwrap(
    Effect.map(RelayHealth, (health) =>
      Stream.map(
        health.changes,
        (snapshot): ReadonlyMap<string, RelayHealthState> =>
          new Map<string, RelayHealthState>(snapshot),
      ),
    ),
  ),
);
