import {
  identityFromNsec,
  InboxCursorStore,
  OutboxStore,
} from "@linky-fit/linkstr";
import type { InboxCursorsRepository } from "@linky-fit/linksync";
import {
  linkstrConfigAtom,
  useAtomSet,
  type LinkstrConfig,
} from "@linky-fit/linkstr-react";
import React from "react";
import {
  getInspectorEmissionEnabled,
  useInspectorEmissionEnabled,
} from "../../devtools/inspector/inspectorEnabled";

import {
  ALLOW_INSECURE_LOCALHOST_RELAYS,
  isRelayUrl,
} from "../../utils/nostrRelays";
import {
  localInboxCursorKey,
  syncedInboxCursorStore,
} from "../lib/syncedInboxCursorStore";
import { useInboxCursorsRepository } from "./useLinksync";

const OUTBOX_STORAGE_KEY = "linky.outbox";

/** `inboxCursors` is null before sign-in, where the cursor stays on this device. */
export const buildLinkstrConfig = (
  currentNsec: string | null,
  fetchRelays: readonly string[],
  inboxCursors: InboxCursorsRepository | null,
  inspectorEnabled: boolean = getInspectorEmissionEnabled(),
): LinkstrConfig | null => {
  if (!currentNsec) return null;
  const identity = identityFromNsec(currentNsec.trim());
  if (!identity) return null;
  const relays = fetchRelays.filter(isRelayUrl);
  return {
    secretKey: identity.secretKey,
    allowInsecureLocalhost: ALLOW_INSECURE_LOCALHOST_RELAYS,
    readRelays: relays,
    writeRelays: relays,
    outboxStore: OutboxStore.fromStringStorage(
      localStorage,
      OUTBOX_STORAGE_KEY,
    ),
    inboxCursorStore:
      inboxCursors === null
        ? InboxCursorStore.fromStringStorage(
            localStorage,
            localInboxCursorKey(identity.pubkey),
          )
        : syncedInboxCursorStore({
            pubkey: identity.pubkey,
            storage: localStorage,
            cursors: inboxCursors,
          }),
    inspector: inspectorEnabled,
  };
};

/** Keeps the linkstr runtime in sync with the active identity and relay list. */
export const useLinkstrConfigSync = ({
  currentNsec,
  nostrFetchRelays,
}: {
  currentNsec: string | null;
  nostrFetchRelays: readonly string[];
}) => {
  const inspectorEnabled = useInspectorEmissionEnabled();
  const setLinkstrConfig = useAtomSet(linkstrConfigAtom);
  const inboxCursors = useInboxCursorsRepository();
  React.useEffect(() => {
    setLinkstrConfig(
      buildLinkstrConfig(
        currentNsec,
        nostrFetchRelays,
        inboxCursors,
        inspectorEnabled,
      ),
    );
  }, [
    currentNsec,
    inboxCursors,
    inspectorEnabled,
    nostrFetchRelays,
    setLinkstrConfig,
  ]);
};
