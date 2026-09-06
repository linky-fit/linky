import { useLatest } from "../../../hooks/useLatest";
import { Schema } from "effect";
import * as Evolu from "@evolu/common";
import { Either } from "effect";
import React from "react";
import { parseTokenText } from "@linky/linkshu";
import { JsonValue } from "../../../types/json";
import {
  LOCAL_NPUB_CASH_CLAIM_LAST_ATTEMPT_STORAGE_KEY_PREFIX,
  LOCAL_NPUB_CASH_CLAIM_LOCK_STORAGE_KEY_PREFIX,
  LOCAL_NPUB_CASH_UPSTREAM_QUOTES_STORAGE_KEY_PREFIX,
} from "../../../utils/constants";
import type { DisplayAmountParts } from "../../../utils/displayAmounts";
import { extractUniqueClaimTokens } from "../../../utils/npubCashClaimResponse";
import {
  isNpubCashDisabled,
  NPUB_CASH_SERVER_BASE_URL,
  NPUB_CASH_UPSTREAM_BASE_URL,
} from "../../../utils/npubCashServer";
import {
  isUpstreamQuoteSettled,
  listUpstreamPaidQuotes,
  parseUpstreamQuoteLedger,
  settleUpstreamQuotes,
} from "../../../utils/npubCashUpstreamQuotes";
import type {
  SettledUpstreamQuote,
  UpstreamPaidQuote,
  UpstreamPaidQuotesListing,
} from "../../../utils/npubCashUpstreamQuotes";
import type { Route } from "../../../types/route";
import {
  safeLocalStorageGet,
  safeLocalStorageSet,
  withLocalStorageLeaseLock,
} from "../../../utils/storage";
import { getUnknownErrorMessage } from "../../../utils/unknown";
import { getInspectorEmissionEnabled } from "../../../devtools/inspector/inspectorEnabled";
import { reportInspectorRows } from "../../../devtools/inspector/reportInspectorRows";
import type {
  LocalMintInfoRow,
  LoggedPaymentEventParams,
  PaymentTelemetryMethod,
} from "../../types/appTypes";
import { describeTaggedCashuError } from "../../lib/cashuStoredError";
import { nowSeconds } from "../../../utils/time";
import type { Translate } from "../../../i18n";
import type {
  AdoptPaidCashuQuote,
  ReceiveCashuToken,
} from "../composition/useLinkshuComposition";

interface UseNpubCashClaimParams {
  /** Null until the linkshu runtime is composed (seed + owners resolved). */
  adoptPaidCashuQuote: AdoptPaidCashuQuote | null;
  cashuIsBusy: boolean;
  currentNpub: string | null;
  currentNsec: string | null;
  enqueueCashuOp: <T>(op: () => Promise<T>) => Promise<T>;
  formatDisplayedAmountParts: (amountSat: number) => DisplayAmountParts;
  isMintDeleted: (mintUrl: string) => boolean;
  logPaymentEvent: (event: LoggedPaymentEventParams) => void;
  makeLocalStorageKey: (prefix: string) => string;
  makeNip98AuthHeader: (
    url: string,
    method: string,
    payload?: Record<string, string>,
  ) => Promise<string>;
  maybeShowPwaNotification: (
    title: string,
    body: string,
    tag?: string,
  ) => Promise<void>;
  mintInfoByUrl: ReadonlyMap<string, LocalMintInfoRow>;
  npubCashClaimInFlightRef: React.MutableRefObject<boolean>;
  /** Null until the linkshu runtime is composed (seed + owners resolved). */
  receiveCashuToken: ReceiveCashuToken | null;
  refreshMintInfo: (mintUrl: string) => Promise<void> | void;
  resolveOwnerIdForWrite: () => Promise<Evolu.OwnerId | null>;
  rememberCashuTokenKnown: (...tokens: readonly string[]) => void;
  routeKind: Route["kind"];
  setCashuIsBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setStatus: React.Dispatch<React.SetStateAction<string | null>>;
  showPaidOverlay: (title?: string) => void;
  t: Translate;
  touchMintInfo: (mintUrl: string, nowSec: number) => void;
}

const NPUB_CASH_CLAIM_IDLE_MIN_INTERVAL_MS = 25_000;
const NPUB_CASH_CLAIM_TOPUP_MIN_INTERVAL_MS = 5_000;
const NPUB_CASH_CLAIM_LOCK_TTL_MS = 20_000;

const readLastClaimAttemptMs = (key: string): number => {
  const raw = safeLocalStorageGet(key);
  if (!raw) return 0;

  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
};

interface ReceivedPayment {
  readonly amount: number;
  readonly mint: string;
  readonly unit: string | null;
  readonly method: PaymentTelemetryMethod;
  readonly details?: JsonValue;
}

const reportUpstreamQuotesListed = (
  listing: UpstreamPaidQuotesListing,
  fresh: readonly UpstreamPaidQuote[],
  since: number | null,
): void => {
  if (!getInspectorEmissionEnabled()) return;
  reportInspectorRows([
    {
      at: Date.now(),
      channel: "cashu",
      tag: "npubCash.upstreamQuotesListed",
      summary: `npub.cash lists ${listing.paid.length} paid quotes, ${fresh.length} new`,
      links: { quote: fresh.map((quote) => quote.quoteId) },
      context: { server: NPUB_CASH_UPSTREAM_BASE_URL },
      payload: {
        since,
        complete: listing.complete,
        paid: listing.paid.length,
        fresh: fresh.map(({ quoteId, mint, amountSat, locked }) => ({
          quoteId,
          mint,
          amountSat,
          locked,
        })),
      },
    },
  ]);
};

/**
 * Collects payments made to the user's lightning addresses, on both hosts
 * that resolve the same npub and regardless of which `lud16` the profile
 * publishes: Linky's own server hands proofs over as tokens (accepted through
 * linkshu `Receive`, like a pasted token), upstream npub.cash only lists paid
 * mint quotes, which linkshu `Topup.adopt` mints. Only the polling, its
 * lock/interval/cursor bookkeeping, and the app-side notifications live here.
 * Transient failures persist nothing; the next poll simply retries.
 */
export const useNpubCashClaim = ({
  adoptPaidCashuQuote,
  cashuIsBusy,
  currentNpub,
  currentNsec,
  enqueueCashuOp,
  formatDisplayedAmountParts,
  isMintDeleted,
  logPaymentEvent,
  makeLocalStorageKey,
  makeNip98AuthHeader,
  maybeShowPwaNotification,
  mintInfoByUrl,
  npubCashClaimInFlightRef,
  receiveCashuToken,
  refreshMintInfo,
  resolveOwnerIdForWrite,
  rememberCashuTokenKnown,
  routeKind,
  setCashuIsBusy,
  setStatus,
  showPaidOverlay,
  t,
  touchMintInfo,
}: UseNpubCashClaimParams) => {
  const announceReceived = React.useCallback(
    ({ amount, mint, unit, method, details }: ReceivedPayment) => {
      const cleanedMint = mint.trim().replace(/\/+$/, "");
      if (cleanedMint && !isMintDeleted(cleanedMint)) {
        const nowSec = nowSeconds();
        const existing = mintInfoByUrl.get(cleanedMint);
        touchMintInfo(cleanedMint, nowSec);

        const lastChecked = (existing?.lastCheckedAtSec ?? 0) || 0;
        if (existing && !lastChecked) void refreshMintInfo(cleanedMint);
      }

      logPaymentEvent({
        direction: "in",
        status: "ok",
        amount,
        fee: null,
        mint,
        unit,
        error: null,
        contactId: null,
        method,
        phase: "receive",
        ...(details === undefined ? {} : { details }),
      });

      const displayAmount =
        amount > 0 ? formatDisplayedAmountParts(amount) : null;

      if (routeKind !== "topupInvoice") {
        showPaidOverlay(
          displayAmount === null
            ? t("cashuAccepted")
            : t("paidReceived")
                .replace(
                  "{amount}",
                  `${displayAmount.approxPrefix}${displayAmount.amountText}`,
                )
                .replace("{unit}", displayAmount.unitLabel),
        );
      }

      void maybeShowPwaNotification(
        t("mints"),
        displayAmount === null
          ? t("cashuAccepted")
          : `${displayAmount.approxPrefix}${displayAmount.amountText} ${displayAmount.unitLabel}`,
        "cashu_claim",
      );
    },
    [
      formatDisplayedAmountParts,
      isMintDeleted,
      logPaymentEvent,
      maybeShowPwaNotification,
      mintInfoByUrl,
      refreshMintInfo,
      routeKind,
      showPaidOverlay,
      t,
      touchMintInfo,
    ],
  );

  const acceptAndStoreCashuToken = React.useCallback(
    async (tokenText: string) => {
      const tokenRaw = tokenText.trim();
      if (!tokenRaw) return;
      if (receiveCashuToken === null) return;

      await enqueueCashuOp(async () => {
        setCashuIsBusy(true);

        const parsed = parseTokenText(tokenRaw);
        const parsedMint = parsed?.mint ?? null;
        const parsedAmount = parsed?.amount ?? null;
        const logFailure = (message: string): void => {
          logPaymentEvent({
            direction: "in",
            status: "error",
            amount: parsedAmount,
            fee: null,
            mint: parsedMint,
            unit: null,
            error: message,
            contactId: null,
            method: "cashu_receive",
            phase: "receive",
          });
        };

        try {
          const outcome = await receiveCashuToken(tokenRaw);

          if (Either.isLeft(outcome)) {
            const error = outcome.left;
            if (error._tag === "TokenAlreadyKnown") return;
            const message = describeTaggedCashuError(error) ?? error._tag;
            logFailure(message);
            setStatus(`${t("cashuAcceptFailed")}: ${message}`);
            return;
          }

          const receipt = outcome.right;
          rememberCashuTokenKnown(tokenRaw, receipt.tokenText);
          announceReceived({
            amount: receipt.amount,
            mint: receipt.mint,
            unit: receipt.unit,
            method: "cashu_receive",
          });
        } catch (error) {
          const message = getUnknownErrorMessage(error, "Accept failed");
          logFailure(message);
          setStatus(`${t("cashuAcceptFailed")}: ${message}`);
        } finally {
          setCashuIsBusy(false);
        }
      });
    },
    [
      announceReceived,
      enqueueCashuOp,
      logPaymentEvent,
      receiveCashuToken,
      rememberCashuTokenKnown,
      setCashuIsBusy,
      setStatus,
      t,
    ],
  );

  const claimFromLinkyServer = React.useCallback(async () => {
    const url = `${NPUB_CASH_SERVER_BASE_URL}/api/v1/claim`;
    const auth = await makeNip98AuthHeader(url, "GET");
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: auth },
    });
    if (!res.ok) return;
    const json = Schema.decodeUnknownSync(JsonValue)(await res.json());
    for (const tokenText of extractUniqueClaimTokens(json)) {
      await acceptAndStoreCashuToken(tokenText);
    }
  }, [acceptAndStoreCashuToken, makeNip98AuthHeader]);

  /**
   * One quote at a time through the wallet queue. A definitive answer —
   * minted, minted elsewhere, or rejected by the mint — settles the quote in
   * the ledger; a transient one leaves it for the next sweep.
   */
  const adoptUpstreamQuote = React.useCallback(
    async (quote: UpstreamPaidQuote): Promise<boolean> => {
      if (adoptPaidCashuQuote === null) return false;
      const outcome = await enqueueCashuOp(async () => {
        setCashuIsBusy(true);
        try {
          return await adoptPaidCashuQuote({
            mint: quote.mint,
            quoteId: quote.quoteId,
            amountSat: quote.amountSat,
            invoice: quote.invoice,
            expiresAt: quote.expiresAt,
            locked: quote.locked,
          });
        } finally {
          setCashuIsBusy(false);
        }
      });

      if (Either.isRight(outcome)) {
        const receipt = outcome.right;
        rememberCashuTokenKnown(receipt.tokenText);
        announceReceived({
          amount: receipt.amount,
          mint: receipt.mint,
          unit: "sat",
          method: "lightning_address",
          details: { lightningInvoice: quote.invoice, quoteId: quote.quoteId },
        });
        return true;
      }

      const error = outcome.left;
      if (error._tag === "QuoteAlreadyIssued") return true;
      const definitive = error._tag === "MintRejected";
      logPaymentEvent({
        direction: "in",
        status: "error",
        amount: quote.amountSat,
        fee: null,
        mint: quote.mint,
        unit: "sat",
        error: describeTaggedCashuError(error) ?? error._tag,
        contactId: null,
        method: "lightning_address",
        phase: "receive",
        details: { quoteId: quote.quoteId, retry: !definitive },
      });
      return definitive;
    },
    [
      adoptPaidCashuQuote,
      announceReceived,
      enqueueCashuOp,
      logPaymentEvent,
      rememberCashuTokenKnown,
      setCashuIsBusy,
    ],
  );

  const sweepUpstreamPaidQuotes = React.useCallback(async () => {
    if (adoptPaidCashuQuote === null) return;
    const ledgerKey = makeLocalStorageKey(
      LOCAL_NPUB_CASH_UPSTREAM_QUOTES_STORAGE_KEY_PREFIX,
    );
    const ledger = parseUpstreamQuoteLedger(safeLocalStorageGet(ledgerKey));
    const listing = await listUpstreamPaidQuotes({
      baseUrl: NPUB_CASH_UPSTREAM_BASE_URL,
      since: ledger.since,
      makeNip98AuthHeader,
    });
    if (listing === null) return;
    const fresh = listing.paid.filter(
      (quote) => !isUpstreamQuoteSettled(ledger, quote.quoteId),
    );
    reportUpstreamQuotesListed(listing, fresh, ledger.since);

    const settled: SettledUpstreamQuote[] = [];
    for (const quote of fresh) {
      if (await adoptUpstreamQuote(quote)) settled.push(quote);
    }
    safeLocalStorageSet(
      ledgerKey,
      JSON.stringify(settleUpstreamQuotes(ledger, settled, listing.complete)),
    );
  }, [
    adoptPaidCashuQuote,
    adoptUpstreamQuote,
    makeLocalStorageKey,
    makeNip98AuthHeader,
  ]);

  const claimNpubCashOnce = React.useCallback(async () => {
    // Don't claim while we are paying/accepting, otherwise we risk consuming
    // the claim response and then skipping token processing.
    if (isNpubCashDisabled()) return;
    if (cashuIsBusy) return;
    if (!currentNpub) return;
    if (!currentNsec) return;
    if (receiveCashuToken === null) return;
    if (npubCashClaimInFlightRef.current) return;
    if (!(await resolveOwnerIdForWrite())) return;

    try {
      const lockKey = makeLocalStorageKey(
        LOCAL_NPUB_CASH_CLAIM_LOCK_STORAGE_KEY_PREFIX,
      );
      const lastAttemptKey = makeLocalStorageKey(
        LOCAL_NPUB_CASH_CLAIM_LAST_ATTEMPT_STORAGE_KEY_PREFIX,
      );

      await withLocalStorageLeaseLock({
        key: lockKey,
        timeoutMs: 0,
        ttlMs: NPUB_CASH_CLAIM_LOCK_TTL_MS,
        fn: async () => {
          if (npubCashClaimInFlightRef.current) return;

          const nowMs = Date.now();
          const minIntervalMs =
            routeKind === "topupInvoice"
              ? NPUB_CASH_CLAIM_TOPUP_MIN_INTERVAL_MS
              : NPUB_CASH_CLAIM_IDLE_MIN_INTERVAL_MS;
          const lastAttemptMs = readLastClaimAttemptMs(lastAttemptKey);
          if (nowMs - lastAttemptMs < minIntervalMs) return;
          safeLocalStorageSet(lastAttemptKey, String(nowMs));

          npubCashClaimInFlightRef.current = true;
          try {
            // Each host on its own: one being down must not starve the other.
            for (const collect of [
              claimFromLinkyServer,
              sweepUpstreamPaidQuotes,
            ]) {
              try {
                await collect();
              } catch (error) {
                console.warn("[linky][npubcash] collect failed", error);
              }
            }
          } finally {
            npubCashClaimInFlightRef.current = false;
          }
        },
      });
    } catch {
      // ignore
    }
  }, [
    cashuIsBusy,
    claimFromLinkyServer,
    currentNpub,
    currentNsec,
    makeLocalStorageKey,
    npubCashClaimInFlightRef,
    receiveCashuToken,
    resolveOwnerIdForWrite,
    routeKind,
    sweepUpstreamPaidQuotes,
  ]);

  const claimNpubCashOnceLatestRef = useLatest(claimNpubCashOnce);

  return {
    claimNpubCashOnce,
    claimNpubCashOnceLatestRef,
  };
};
