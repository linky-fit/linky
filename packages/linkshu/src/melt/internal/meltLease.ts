import { Effect } from "effect";
import type { MintUrl, QuoteId } from "../../domain/primitives";
import { tryWithKeyLease, withKeyLease } from "../../internal/lease";
import type { KeyValueStoreService } from "../../ports/KeyValueStore";
import { PaymentFailed } from "../../domain/errors";

const MELT_LOCK_KEY_PREFIX = "linkshu.meltLock.";

interface MeltRef {
  readonly mint: MintUrl;
  readonly quoteId: QuoteId;
}

const meltLockKey = (ref: MeltRef): string =>
  MELT_LOCK_KEY_PREFIX +
  [ref.mint, ref.quoteId].map(encodeURIComponent).join(".");

/**
 * Held by the context paying a quote from before its inputs are funded until
 * the melt settles or is handed to `resumePending`. The mint answers UNPAID
 * for a melt whose request has not reached it yet, so a resume reading that
 * answer must not release the inputs of a melt that is still being paid.
 */
export const withMeltLease =
  (kv: KeyValueStoreService, ref: MeltRef) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    withKeyLease(
      kv,
      meltLockKey(ref),
    )(effect).pipe(
      Effect.catchTag(
        "LeaseLockTimeout",
        () =>
          new PaymentFailed({
            mint: ref.mint,
            quoteId: ref.quoteId,
            detail: "another payment of this quote is still running",
          }),
      ),
    );

/** Resume's side of `withMeltLease`: `None` while a payment of the quote runs. */
export const tryWithMeltLease = (kv: KeyValueStoreService, ref: MeltRef) =>
  tryWithKeyLease(kv, meltLockKey(ref));
