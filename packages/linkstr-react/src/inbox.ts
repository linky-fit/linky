import { Atom } from "@effect-atom/atom-react";
import { WrapInbox } from "@linky-fit/linkstr";
import type {
  DeliveredInboxEvent,
  InboxDelivery,
  RelayUrl,
  UnixSeconds,
  WrapId,
  WrapInboxEvent,
} from "@linky-fit/linkstr";
import { Effect, Stream } from "effect";
import { linkstrRuntimeAtom } from "./runtime";

export interface WrapInboxHandler {
  /** Backfill start when the configured cursor store holds no cursor yet. */
  readonly since?: UnixSeconds;
  /**
   * Called once per inbox event, in order; the next event waits for it.
   * `delivery` is "live" only for events published after the relay's EOSE —
   * the ones worth interrupting the user for.
   */
  readonly onEvent: (
    event: WrapInboxEvent,
    delivery: InboxDelivery,
  ) => void | Promise<void>;
}

/** Null keeps the inbox closed; the app registers a handler to open it. */
export const wrapInboxHandlerAtom = Atom.make<WrapInboxHandler | null>(null);

export interface FetchWrapEventParams {
  readonly wrapId: WrapId;
  readonly extraRelays?: ReadonlyArray<RelayUrl>;
}

export const fetchWrapEventAtom = linkstrRuntimeAtom.fn<FetchWrapEventParams>()(
  (params) =>
    Effect.flatMap(WrapInbox, (inbox) =>
      inbox.fetchWrapEvent(
        params.wrapId,
        params.extraRelays === undefined
          ? undefined
          : { extraRelays: params.extraRelays },
      ),
    ),
);

/**
 * While mounted (and a handler is registered), runs the single kind-1059
 * subscription and feeds every typed inbox event through the handler.
 * Unmounting — or a config/handler swap — closes the relay subscriptions.
 * The atom's value is the last handled event, which is useful for debugging.
 */
export const wrapInboxAtom = linkstrRuntimeAtom.atom((get) => {
  const handler = get(wrapInboxHandlerAtom);
  if (handler === null) return Stream.empty;
  return Stream.unwrapScoped(
    Effect.gen(function* () {
      const inbox = yield* WrapInbox;
      const feed = yield* inbox.open(
        handler.since === undefined ? {} : { since: handler.since },
      );
      const handle = (delivered: DeliveredInboxEvent) =>
        Effect.promise(async () => {
          await handler.onEvent(delivered.event, delivered.delivery);
        }).pipe(Effect.as(delivered));
      return Stream.mapEffect(feed.events, handle);
    }),
  );
});
