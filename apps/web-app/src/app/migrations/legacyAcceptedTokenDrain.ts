// Legacy migration; removal gate in docs/architecture.md
//
// Pre-cutover releases parked the last accepted token text in
// `linky.lastAcceptedCashuToken.v1` as crash insurance: the Evolu row write
// could trail the accept, so the next launch re-persisted a remembered token
// that had no row. Nothing has written the key since the receive cutover
// (#301), but a device upgrading straight from a pre-cutover build may still
// hold an uningested token here, so it drains once through linkshu Receive
// (which dedupes against stored rows and swaps at the mint) and the key is
// deleted on any definitive outcome. Only a transient mint failure keeps the
// key for a retry on the next launch.
//
// Removal condition: delete this file and its marked call site in
// useCashuWalletComposition together with linkshuStorageMigration.ts.

import { Either } from "effect";
import {
  safeLocalStorageGet,
  safeLocalStorageRemove,
} from "../../utils/storage";
import type { ReceiveCashuToken } from "../hooks/composition/useLinkshuComposition";

const LEGACY_KEY = "linky.lastAcceptedCashuToken.v1";

let drainInFlight = false;

export const drainLegacyAcceptedCashuToken = async (
  receiveCashuToken: ReceiveCashuToken,
): Promise<void> => {
  if (drainInFlight) return;
  drainInFlight = true;
  try {
    const remembered = (safeLocalStorageGet(LEGACY_KEY) ?? "").trim();
    if (!remembered) {
      // Pre-cutover code cleared the key by writing "", so an empty leftover
      // is common; deleting it retires the key for good.
      safeLocalStorageRemove(LEGACY_KEY);
      return;
    }

    const outcome = await receiveCashuToken(remembered);
    const transient =
      Either.isLeft(outcome) &&
      (outcome.left._tag === "MintUnreachable" ||
        outcome.left._tag === "CounterLockTimeout");
    if (!transient) safeLocalStorageRemove(LEGACY_KEY);
  } catch {
    // Runtime shut down mid-receive: retry next launch.
  } finally {
    drainInFlight = false;
  }
};
