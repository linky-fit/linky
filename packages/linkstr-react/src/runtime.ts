import { Atom } from "@effect-atom/atom-react";
import {
  Inspector,
  inspectTransport,
  linkstrServices,
  makeNostrTransportSimplePool,
  observeTransport,
  RelayHealth,
} from "@linky/linkstr";
import { Layer } from "effect";
import { linkstrConfigAtom } from "./config";
import { LinkstrNotConfigured } from "./errors";

/**
 * Rebuilds whenever `linkstrConfigAtom` changes, finalizing the previous
 * runtime's scope (and with it the relay pool). Base services stay merged in
 * so future verticals can hang their fn atoms off this runtime too.
 *
 * `Layer.fresh` is load-bearing: the service layers are stable references,
 * and Atom.runtime's shared memo map would otherwise reuse instances built
 * for a previous config (a race on identity switch).
 */
export const linkstrRuntimeAtom = Atom.runtime((get) => {
  const config = get(linkstrConfigAtom);
  return config === null
    ? Layer.fail(new LinkstrNotConfigured())
    : Layer.fresh(
        linkstrServices({
          secretKey: config.secretKey,
          readRelays: config.readRelays,
          writeRelays: config.writeRelays,
          // Both decorators are transparent taps over the same raw transport:
          // health folds connection state, the inspector streams diagnostics.
          transport: inspectTransport(
            observeTransport(
              config.transport ??
                makeNostrTransportSimplePool({
                  allowInsecureLocalhost: config.allowInsecureLocalhost,
                }),
            ),
          ),
          outboxStore: config.outboxStore,
          inboxCursorStore: config.inboxCursorStore,
        }).pipe(
          Layer.provideMerge(
            config.inspector === true ? Inspector.live : Inspector.disabled,
          ),
          // Unlike the inspector, relay health is not dev-gated: it is the
          // production source of the relay settings status UI.
          Layer.provideMerge(RelayHealth.live),
        ),
      );
});
