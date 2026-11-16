import React from "react";
import {
  isNpubDefaultNip05,
  resolveVerifiedNip05Identifier,
} from "../../../utils/nostrNip05";

const VERIFY_TIMEOUT_MS = 5000;
const VERIFIED_CACHE_LIMIT = 200;

// Search results re-render often and repeat across queries; each claim is checked once per session.
const verifications = new Map<string, Promise<string | null>>();

const verifyOnce = (nip05: string, npub: string): Promise<string | null> => {
  const key = `${nip05.toLowerCase()} ${npub}`;
  const known = verifications.get(key);
  if (known) return known;
  if (verifications.size >= VERIFIED_CACHE_LIMIT) verifications.clear();
  const verification = resolveVerifiedNip05Identifier(nip05, npub, {
    signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
  }).catch(() => null);
  verifications.set(key, verification);
  return verification;
};

/**
 * The NIP-05 identifier a profile claims, once its domain's
 * `/.well-known/nostr.json` confirms it names this npub; null until then.
 */
export const useVerifiedNip05 = (
  npub: string | null,
  nip05: string | null | undefined,
): string | null => {
  const trimmed = (nip05 ?? "").trim();
  const claim = isNpubDefaultNip05(trimmed) ? "" : trimmed;
  const [verified, setVerified] = React.useState<{
    identifier: string | null;
    key: string;
  } | null>(null);
  const key = `${claim} ${npub ?? ""}`;

  React.useEffect(() => {
    if (!npub || !claim) return;
    let cancelled = false;
    void verifyOnce(claim, npub).then((identifier) => {
      if (!cancelled) setVerified({ identifier, key });
    });
    return () => {
      cancelled = true;
    };
  }, [claim, key, npub]);

  return verified?.key === key ? verified.identifier : null;
};
