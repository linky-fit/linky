import React from "react";

const DEFAULT_MIN_WAIT_MS = 2_500;
const DEFAULT_QUIET_WINDOW_MS = 500;
const DEFAULT_MAX_WAIT_MS = 8_000;

interface UseEvoluNostrBootstrapReadyParams {
  contactsSnapshot: ReadonlyArray<object>;
  enabled: boolean;
  identitiesSnapshot: ReadonlyArray<object>;
  identityReady: boolean;
  maxWaitMs?: number;
  messagesSnapshot: ReadonlyArray<object>;
  minWaitMs?: number;
  ownerKey: string;
  quietWindowMs?: number;
  reactionsSnapshot: ReadonlyArray<object>;
  tokensSnapshot: ReadonlyArray<object>;
  transactionsSnapshot: ReadonlyArray<object>;
}

/**
 * Holds passive Nostr network work until the shard store's initial sync has
 * had time to hydrate the local reads. Evolu does not expose an
 * initial-sync-complete signal, so readiness is a bounded quiet-window
 * barrier: the app owner must be known, relevant reads must stop changing,
 * and the synced identity must be settled before Nostr is released.
 */
export const useEvoluNostrBootstrapReady = ({
  contactsSnapshot,
  enabled,
  identitiesSnapshot,
  identityReady,
  maxWaitMs = DEFAULT_MAX_WAIT_MS,
  messagesSnapshot,
  minWaitMs = DEFAULT_MIN_WAIT_MS,
  ownerKey,
  quietWindowMs = DEFAULT_QUIET_WINDOW_MS,
  reactionsSnapshot,
  tokensSnapshot,
  transactionsSnapshot,
}: UseEvoluNostrBootstrapReadyParams): boolean => {
  const [isOnline, setIsOnline] = React.useState(
    () => typeof navigator === "undefined" || navigator.onLine !== false,
  );
  const [releasedOwnerKey, setReleasedOwnerKey] = React.useState<string | null>(
    null,
  );
  const startedAtMsRef = React.useRef(0);

  React.useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  React.useEffect(() => {
    if (!enabled || !isOnline || !ownerKey) {
      startedAtMsRef.current = 0;
      setReleasedOwnerKey(null);
      return;
    }

    startedAtMsRef.current = Date.now();
  }, [enabled, isOnline, ownerKey]);

  React.useEffect(() => {
    if (!enabled || !isOnline || !ownerKey || !identityReady) return;

    const elapsedMs = Math.max(0, Date.now() - startedAtMsRef.current);
    const remainingMaxWaitMs = Math.max(0, maxWaitMs - elapsedMs);
    const timeoutId = window.setTimeout(
      () => {
        setReleasedOwnerKey(ownerKey);
      },
      Math.max(quietWindowMs, remainingMaxWaitMs),
    );

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [enabled, identityReady, isOnline, maxWaitMs, ownerKey, quietWindowMs]);

  React.useEffect(() => {
    if (!enabled || !isOnline || !ownerKey || !identityReady) return;
    if (releasedOwnerKey === ownerKey) return;

    const elapsedMs = Math.max(0, Date.now() - startedAtMsRef.current);
    const remainingMinWaitMs = Math.max(0, minWaitMs - elapsedMs);
    const releaseDelayMs = Math.max(quietWindowMs, remainingMinWaitMs);
    const timeoutId = window.setTimeout(() => {
      setReleasedOwnerKey(ownerKey);
    }, releaseDelayMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    contactsSnapshot,
    enabled,
    identitiesSnapshot,
    identityReady,
    isOnline,
    messagesSnapshot,
    minWaitMs,
    ownerKey,
    quietWindowMs,
    reactionsSnapshot,
    releasedOwnerKey,
    tokensSnapshot,
    transactionsSnapshot,
  ]);

  return (
    enabled &&
    isOnline &&
    Boolean(ownerKey) &&
    identityReady &&
    releasedOwnerKey === ownerKey
  );
};
