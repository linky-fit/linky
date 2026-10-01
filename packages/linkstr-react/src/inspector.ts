import { Atom } from "effect/reactivity";
import { Inspector } from "@linky-fit/linkstr";
import type { InspectorEvent } from "@linky-fit/linkstr";
import { Effect, Stream } from "effect";
import { linkstrRuntimeAtom } from "./runtime";

/** An object (not a bare function) so setting it never hits the atom
 * setter's updater-form interpretation of function values. */
export interface InspectorHandler {
  readonly onEvent: (event: InspectorEvent) => void;
}

/** Where inspector events go; null keeps the feed unconsumed. */
export const inspectorHandlerAtom = Atom.make<InspectorHandler | null>(null);

/**
 * Mount to run the inspector feed as long as a handler is set. Emits nothing
 * unless the config enables the inspector (`Inspector.disabled` yields an
 * empty stream).
 */
export const inspectorEventsAtom = linkstrRuntimeAtom.atom((get) => {
  const handler = get(inspectorHandlerAtom);
  if (handler === null) return Stream.empty;
  return Stream.unwrap(
    Effect.map(Inspector, (inspector) =>
      Stream.tap(inspector.events, (event) =>
        Effect.sync(() => handler.onEvent(event)),
      ),
    ),
  );
});
