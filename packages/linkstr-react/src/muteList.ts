import { Atom } from "effect/reactivity";
import { MuteList } from "@linky-fit/linkstr";
import type { FetchedMuteList } from "@linky-fit/linkstr";
import { Effect, Stream } from "effect";
import { linkstrRuntimeAtom } from "./runtime";

export interface MuteListWatchHandler {
  readonly onList: (list: FetchedMuteList) => void;
}

/** Null keeps the watch closed; the app registers a handler to open it. */
export const muteListWatchHandlerAtom = Atom.make<MuteListWatchHandler | null>(
  null,
);

/**
 * While mounted (and a handler is registered), follows the identity's own
 * mute list and feeds each newer list through the handler. A config or
 * handler swap reopens the subscriptions.
 */
export const muteListWatchAtom = linkstrRuntimeAtom.atom((get) => {
  const handler = get(muteListWatchHandlerAtom);
  if (handler === null) return Stream.empty;
  return Stream.unwrap(
    Effect.gen(function* () {
      const muteList = yield* MuteList;
      const lists = yield* muteList.watchOwnMuteList();
      return Stream.tap(lists, (list) =>
        Effect.sync(() => handler.onList(list)),
      );
    }),
  );
});
