import { useEffect, useState } from "react";
import { resolveVerifiedNip05Identifier } from "../../../utils/nostrNip05";

// Shared across rows and screens so a search keystroke or a revisit does not refetch.
const verifications = new Map<string, Promise<string | null>>();

const verify = (nip05: string, npub: string): Promise<string | null> => {
  const key = `${nip05.toLowerCase()} ${npub}`;
  const cached = verifications.get(key);
  if (cached) return cached;
  const pending = resolveVerifiedNip05Identifier(nip05, npub).catch(() => null);
  verifications.set(key, pending);
  // A failed lookup may succeed later, e.g. once the device is back online.
  void pending.then((identifier) => {
    if (!identifier) verifications.delete(key);
  });
  return pending;
};

/** The profile's NIP-05 identifier once its domain confirms it names `npub`, else null. */
export const useVerifiedNip05 = (
  npub: string | null,
  nip05: string | null | undefined,
): string | null => {
  const [verified, setVerified] = useState<{
    identifier: string;
    key: string;
  } | null>(null);
  const key = npub && nip05 ? `${nip05} ${npub}` : null;

  useEffect(() => {
    if (!npub || !nip05) return;
    let cancelled = false;
    void verify(nip05, npub).then((identifier) => {
      if (!cancelled && identifier) {
        setVerified({ identifier, key: `${nip05} ${npub}` });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [npub, nip05]);

  return verified && verified.key === key ? verified.identifier : null;
};

/** Whether `address` is the identifier `useVerifiedNip05` confirmed. */
export const isVerifiedAddress = (
  verifiedNip05: string | null,
  address: string,
): boolean =>
  Boolean(verifiedNip05) &&
  verifiedNip05?.toLowerCase() === address.trim().toLowerCase();
