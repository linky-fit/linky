import { transactionIdForOperation } from "@linky-fit/linksync";
import type { PaidOverlayDetails } from "../../lib/paidOverlay";
import { useLatest } from "../../../hooks/useLatest";
import { Schema } from "effect";
import { Either } from "effect";
import React from "react";
import { parseTokenText, type OperationId } from "@linky-fit/linkshu";
import { JsonValue } from "../../../types/json";
import {
  LOCAL_NPUB_CASH_CLAIM_INBOX_STORAGE_KEY_PREFIX,
  LOCAL_NPUB_CASH_CLAIM_LAST_ATTEMPT_STORAGE_KEY_PREFIX,
  LOCAL_NPUB_CASH_CLAIM_LOCK_STORAGE_KEY_PREFIX,
  LOCAL_NPUB_CASH_UPSTREAM_QUOTES_STORAGE_KEY_PREFIX,
} from "../../../utils/constants";
import type { DisplayAmountParts } from "../../../utils/displayAmounts";
import {
  addToClaimInbox,
  readClaimInbox,
  removeFromClaimInbox,
} from "../../../utils/npubCashClaimInbox";
import { extractUniqueClaimTokens } from "../../../utils/npubCashClaimResponse";
import {
  isNpubCashDisabled,
  NPUB_CASH_REQUEST_TIMEOUT_MS,
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
import type { PushToastOptions } from "../../../hooks/useToasts";
import {
  safeLocalStorageGet,
  safeLocalStorageSet,
  withTabLockIfFree,
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
import { touchReceivingMint } from "../../lib/receivingMint";
import { isHiddenTestMint } from "../../../utils/mint";
import type { Translate } from "../../../i18n";
import type {
  AdoptPaidCashuQuote,
  ReceiveCashuToken,
} from "../composition/useLinkshuComposition";

interface UseNpubCashClaimParams {
  allowTestMints: boolean;
  /** Null until the linkshu runtime is composed (seed + owners resolved). */
  adoptPaidCashuQuote: AdoptPaidCashuQuote | null;
  cashuIsBusy: boolean;
  copyText: (value: string) => Promise<void>;
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
  pushToast: (message: string, options?: PushToastOptions) => void;
  /** Null until the linkshu runtime is composed (seed + owners resolved). */
  receiveCashuToken: ReceiveCashuToken | null;
  refreshMintInfo: (mintUrl: string) => Promise<void> | void;
  rememberCashuTokenKnown: (...tokens: readonly string[]) => void;
  routeKind: Route["kind"];
  setCashuIsBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setStatus: React.Dispatch<React.SetStateAction<string | null>>;
  showPaidOverlay: (title?: string, details?: PaidOverlayDetails) => void;
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
  readonly operationId: OperationId;
  readonly unit: string | null;
  readonly method: PaymentTelemetryMethod;
  readonly details?: JsonValue;
}

const reportClaimsUnsaved = (count: number): void => {
  if (!getInspectorEmissionEnabled()) return;
  reportInspectorRows([
    {
      at: Date.now(),
      channel: "cashu",
      tag: "npubCash.claimsUnsaved",
      summary: `storage refused ${count} claimed npub.cash tokens; kept for this session only`,
      links: {},
      context: { server: NPUB_CASH_SERVER_BASE_URL },
      payload: { count },
    },
  ]);
};

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
 * mint quotes, which linkshu `Topup.adopt` mints on upstream's chosen mint.
 * `<npub>@npub.cash` funds must not auto-swap to the default mint.
 * Only polling, lock/interval/cursor bookkeeping, and app-side notifications
 * live here.
 * Claimed tokens wait in a device-local inbox until linkshu holds or settles
 * them; upstream quotes stay listed until adopted. The next poll retries both.
 * A token the inbox could not store is held for this session and received at
 * once; the first poll it is neither stored nor received offers to copy it.
 */
export const useNpubCashClaim = ({
  adoptPaidCashuQuote,
  allowTestMints,
  cashuIsBusy,
  copyText,
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
  pushToast,
  receiveCashuToken,
  refreshMintInfo,
  rememberCashuTokenKnown,
  routeKind,
  setCashuIsBusy,
  setStatus,
  showPaidOverlay,
  t,
  touchMintInfo,
}: UseNpubCashClaimParams) => {
  const unsavedClaimsRef = React.useRef<readonly string[]>([]);
  const offeredCopiesRef = React.useRef(new Set<string>());

  const announceReceived = React.useCallback(
    ({ amount, details, method, mint, operationId, unit }: ReceivedPayment) => {
      touchReceivingMint(mint, {
        isMintDeleted,
        mintInfoByUrl,
        refreshMintInfo,
        touchMintInfo,
      });

      logPaymentEvent({
        direction: "in",
        status: "ok",
        transactionId: transactionIdForOperation(operationId),
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
          { direction: "in", amountSat: amount > 0 ? amount : null },
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

  /**
   * True once the token needs no copy here: linkshu received it, keeps it
   * (a deferral, or a receive that carries it) or refused it for good.
   */
  const receiveClaimedToken = React.useCallback(
    async (tokenText: string): Promise<boolean> => {
      const tokenRaw = tokenText.trim();
      if (!tokenRaw) return true;
      if (receiveCashuToken === null) return false;

      return enqueueCashuOp(async () => {
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
          // Left in the inbox: turning test mints back on receives it.
          if (isHiddenTestMint(parsedMint, allowTestMints)) return false;
          const outcome = await receiveCashuToken(tokenRaw, {
            automatic: true,
          });

          if (Either.isLeft(outcome)) {
            const error = outcome.left;
            // A receive that waited out another one's turn wrote nothing.
            if (error._tag === "CounterLockTimeout") return false;
            // A deferred token is kept by linkshu and received on a later retry.
            if (
              error._tag === "TokenAlreadyKnown" ||
              error._tag === "ReceiveDeferred"
            )
              return true;
            const message = describeTaggedCashuError(error) ?? error._tag;
            logFailure(message);
            setStatus(`${t("cashuAcceptFailed")}: ${message}`);
            return true;
          }

          const receipt = outcome.right;
          rememberCashuTokenKnown(tokenRaw, receipt.tokenText);
          announceReceived({
            amount: receipt.amount,
            mint: receipt.mint,
            operationId: receipt.operationId,
            unit: receipt.unit,
            method: "cashu_receive",
          });
          return true;
        } catch (error) {
          const message = getUnknownErrorMessage(error, "Accept failed");
          logFailure(message);
          setStatus(`${t("cashuAcceptFailed")}: ${message}`);
          return false;
        } finally {
          setCashuIsBusy(false);
        }
      });
    },
    [
      allowTestMints,
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

  /** Lets go of each token linkshu now holds or settled. */
  const receiveClaims = React.useCallback(
    async (inboxKey: string, tokens: readonly string[]) => {
      for (const tokenText of tokens) {
        if (await receiveClaimedToken(tokenText)) {
          removeFromClaimInbox(inboxKey, tokenText);
          unsavedClaimsRef.current = unsavedClaimsRef.current.filter(
            (unsaved) => unsaved !== tokenText,
          );
        } else if (
          unsavedClaimsRef.current.includes(tokenText) &&
          !offeredCopiesRef.current.has(tokenText)
        ) {
          offeredCopiesRef.current.add(tokenText);
          pushToast(t("npubCashClaimUnsaved"), {
            action: {
              label: t("copy"),
              onClick: () => void copyText(tokenText),
            },
          });
        }
      }
    },
    [copyText, pushToast, receiveClaimedToken, t],
  );

  const claimFromLinkyServer = React.useCallback(async (): Promise<
    readonly string[]
  > => {
    const url = `${NPUB_CASH_SERVER_BASE_URL}/api/v1/claim`;
    const auth = await makeNip98AuthHeader(url, "GET");
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: auth },
      signal: AbortSignal.timeout(NPUB_CASH_REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const json = Schema.decodeUnknownSync(JsonValue)(await res.json());
    return extractUniqueClaimTokens(json);
  }, [makeNip98AuthHeader]);

  /**
   * Saved claims are received before the server is asked, so a stalled
   * claim request never holds them back.
   */
  const collectFromLinkyServer = React.useCallback(async () => {
    const inboxKey = makeLocalStorageKey(
      LOCAL_NPUB_CASH_CLAIM_INBOX_STORAGE_KEY_PREFIX,
    );
    unsavedClaimsRef.current = addToClaimInbox(
      inboxKey,
      unsavedClaimsRef.current,
    );
    await receiveClaims(inboxKey, [
      ...readClaimInbox(inboxKey),
      ...unsavedClaimsRef.current,
    ]);

    const claimed = await claimFromLinkyServer();
    const refused = addToClaimInbox(inboxKey, claimed);
    if (refused.length > 0) {
      reportClaimsUnsaved(refused.length);
      unsavedClaimsRef.current = [
        ...unsavedClaimsRef.current,
        ...refused.filter((token) => !unsavedClaimsRef.current.includes(token)),
      ];
    }
    await receiveClaims(inboxKey, claimed);
  }, [claimFromLinkyServer, makeLocalStorageKey, receiveClaims]);

  /**
   * One quote at a time through the wallet queue. A definitive answer —
   * minted, minted elsewhere, or rejected by the mint — settles the quote in
   * the ledger; a transient one leaves it for the next sweep.
   */
  const adoptUpstreamQuote = React.useCallback(
    async (quote: UpstreamPaidQuote): Promise<boolean> => {
      if (adoptPaidCashuQuote === null) return false;
      // Left in the ledger: turning test mints back on adopts it.
      if (isHiddenTestMint(quote.mint, allowTestMints)) return false;
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
          operationId: receipt.operationId,
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
      allowTestMints,
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

    try {
      const lockKey = makeLocalStorageKey(
        LOCAL_NPUB_CASH_CLAIM_LOCK_STORAGE_KEY_PREFIX,
      );
      const lastAttemptKey = makeLocalStorageKey(
        LOCAL_NPUB_CASH_CLAIM_LAST_ATTEMPT_STORAGE_KEY_PREFIX,
      );

      await withTabLockIfFree({
        key: lockKey,
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
              collectFromLinkyServer,
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
    collectFromLinkyServer,
    currentNpub,
    currentNsec,
    makeLocalStorageKey,
    npubCashClaimInFlightRef,
    receiveCashuToken,
    routeKind,
    sweepUpstreamPaidQuotes,
  ]);

  const claimNpubCashOnceLatestRef = useLatest(claimNpubCashOnce);

  return {
    claimNpubCashOnce,
    claimNpubCashOnceLatestRef,
  };
};
