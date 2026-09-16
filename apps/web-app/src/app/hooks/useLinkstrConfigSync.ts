import {
  identityFromNsec,
  InboxCursorStore,
  OutboxStore,
} from "@linky/linkstr";
import {
  linkstrConfigAtom,
  useAtomSet,
  type LinkstrConfig,
} from "@linky/linkstr-react";
import React from "react";
import {
  getInspectorEmissionEnabled,
  useInspectorEmissionEnabled,
} from "../../devtools/inspector/inspectorEnabled";

import {
  ALLOW_INSECURE_LOCALHOST_RELAYS,
  isRelayUrl,
} from "../../utils/nostrRelays";

const OUTBOX_STORAGE_KEY = "linky.outbox";
const INBOX_CURSOR_STORAGE_KEY_PREFIX = "linky.inbox_cursor";

export const buildLinkstrConfig = (
  currentNsec: string | null,
  fetchRelays: readonly string[],
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
    inboxCursorStore: InboxCursorStore.fromStringStorage(
      localStorage,
      `${INBOX_CURSOR_STORAGE_KEY_PREFIX}.${identity.pubkey}`,
    ),
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
  React.useEffect(() => {
    setLinkstrConfig(
      buildLinkstrConfig(currentNsec, nostrFetchRelays, inspectorEnabled),
    );
  }, [currentNsec, inspectorEnabled, nostrFetchRelays, setLinkstrConfig]);
};
