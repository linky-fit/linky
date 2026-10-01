import {
  Context,
  Effect,
  Equal,
  Layer,
  Schema,
  Stream,
  SubscriptionRef,
} from "effect";
import { RelayUrl, UnixSeconds } from "../domain/primitives";
import type { RelayPublishResult } from "../services/NostrTransport";

export const RelayConnectionState = Schema.Literals([
  "connecting",
  "connected",
  "unreachable",
]);
export type RelayConnectionState = typeof RelayConnectionState.Type;

/** Outcome of the most recent publish attempt against one relay. */
export class RelayPublishOutcome extends Schema.Class<RelayPublishOutcome>(
  "RelayPublishOutcome",
)({
  at: UnixSeconds,
  accepted: Schema.Boolean,
  detail: Schema.NullOr(Schema.String),
}) {}

export class RelayHealthState extends Schema.Class<RelayHealthState>(
  "RelayHealthState",
)({
  state: RelayConnectionState,
  /** Last close/error reason; meaningful while `state` is "unreachable". */
  detail: Schema.NullOr(Schema.String),
  /**
   * Last evidence the relay served us: an event, EOSE, a fetch result or an
   * accepted publish.
   */
  lastSeenAt: Schema.NullOr(UnixSeconds),
  lastErrorAt: Schema.NullOr(UnixSeconds),
  /**
   * Write relays may carry no subscription, so their freshest signal is the
   * last publish outcome; consumers should show its timestamp so staleness
   * stays honest.
   */
  lastPublish: Schema.NullOr(RelayPublishOutcome),
}) {}

export type RelayHealthSnapshot = ReadonlyMap<RelayUrl, RelayHealthState>;

export interface RelayHealthService {
  readonly current: Effect.Effect<RelayHealthSnapshot>;
  /** Emits the current snapshot on subscription, then every change. */
  readonly changes: Stream.Stream<RelayHealthSnapshot>;
  /** A subscription attempt started: "connecting" unless already connected. */
  readonly reportSubscribing: (relay: RelayUrl) => void;
  /** The relay demonstrably served us: "connected", detail cleared. */
  readonly reportSeen: (relay: RelayUrl) => void;
  /** A subscription or fetch ended or failed: "unreachable" with the reason. */
  readonly reportUnreachable: (relay: RelayUrl, detail: string | null) => void;
  readonly reportPublishResult: (result: RelayPublishResult) => void;
}

const blankState = new RelayHealthState({
  state: "connecting",
  detail: null,
  lastSeenAt: null,
  lastErrorAt: null,
  lastPublish: null,
});

// Reporters are sync so transport callbacks can report without running
// Effects (same rationale as Inspector.emit); timestamps therefore come from
// Date.now rather than Clock.
const nowSeconds = (): UnixSeconds =>
  UnixSeconds.make(Math.max(1, Math.floor(Date.now() / 1000)));

const make: Effect.Effect<RelayHealthService> = Effect.gen(function* () {
  const ref = yield* SubscriptionRef.make<RelayHealthSnapshot>(new Map());

  // Value-equal transitions are skipped; with 1s timestamp granularity that
  // caps an event flood at one snapshot write per relay per second.
  const apply = (
    relay: RelayUrl,
    transition: (current: RelayHealthState) => RelayHealthState,
  ): void =>
    Effect.runSync(
      Effect.flatMap(SubscriptionRef.get(ref), (snapshot) => {
        const current = snapshot.get(relay) ?? blankState;
        const next = transition(current);
        if (snapshot.has(relay) && Equal.equals(current, next)) {
          return Effect.void;
        }
        return SubscriptionRef.set(ref, new Map(snapshot).set(relay, next));
      }),
    );

  return {
    current: SubscriptionRef.get(ref),
    changes: SubscriptionRef.changes(ref),
    reportSubscribing: (relay) =>
      apply(relay, (current) =>
        current.state === "connected"
          ? current
          : new RelayHealthState({ ...current, state: "connecting" }),
      ),
    reportSeen: (relay) =>
      apply(
        relay,
        (current) =>
          new RelayHealthState({
            ...current,
            state: "connected",
            detail: null,
            lastSeenAt: nowSeconds(),
          }),
      ),
    reportUnreachable: (relay, detail) =>
      apply(
        relay,
        (current) =>
          new RelayHealthState({
            ...current,
            state: "unreachable",
            detail,
            lastErrorAt: nowSeconds(),
          }),
      ),
    // An accepted publish proves the relay is serving us, so it promotes the
    // state to "connected". A failed publish only records the outcome: the
    // transport cannot distinguish a policy rejection (relay alive) from a
    // connection failure, so it must not demote a live subscription's state.
    reportPublishResult: (result) =>
      apply(result.relay, (current) => {
        const at = nowSeconds();
        const lastPublish = new RelayPublishOutcome({
          at,
          accepted: result.accepted,
          detail: result.detail,
        });
        return result.accepted
          ? new RelayHealthState({
              ...current,
              state: "connected",
              detail: null,
              lastSeenAt: at,
              lastPublish,
            })
          : new RelayHealthState({ ...current, lastErrorAt: at, lastPublish });
      }),
  };
});

/**
 * Always-on per-relay connection health, folded from the traffic linkstr
 * actually produces (unlike the dev-only Inspector, which is a diagnostics
 * feed). `observeTransport` is its feeder; without that decorator — or
 * without this layer — nothing breaks, the snapshot just stays empty.
 */
export class RelayHealth extends Context.Service<
  RelayHealth,
  RelayHealthService
>()("linkstr/RelayHealth") {
  static readonly live: Layer.Layer<RelayHealth> = Layer.effect(
    RelayHealth,
    make,
  );
}
