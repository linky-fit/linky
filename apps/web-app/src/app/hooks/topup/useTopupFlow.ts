import { transactionIdForQuote } from "@linky-fit/linksync";
import type { TopupError, TopupQuote } from "@linky-fit/linkshu";
import type { PaidOverlayDetails } from "../../lib/paidOverlay";
import { useAtom, useAtomSet, useAtomValue } from "@linky-fit/linkstr-react";
import { Result } from "effect";
import React from "react";
import { useLatest } from "../../../hooks/useLatest";
import { navigateTo } from "../../../hooks/useRouting";
import type { Route } from "../../../types/route";
import {
  buildBip321PaymentUri,
  PaymentRequestId,
} from "@linky-fit/linkshu/payment-request";
import { reportAppLog } from "../../../devtools/inspector/appLog";
import { makeLocalId } from "../../../utils/validation";
import type { DisplayAmountParts } from "../../../utils/displayAmounts";
import { getLightningInvoicePreview } from "@linky-fit/linkshu";
import { MAIN_MINT_URL, normalizeMintUrl } from "../../../utils/mint";
import { describeTaggedCashuError } from "../../lib/cashuStoredError";
import { buildCashuPaymentRequestMessage } from "../../lib/paymentRequestMessage";
import type { LoggedPaymentEventParams } from "../../types/appTypes";
import { useResumeOnLaunchAndOnline } from "../useResumeOnLaunchAndOnline";
import type {
  CashuTopupHandle,
  ResumePendingCashuTopups,
  StartCashuTopup,
} from "../composition/useLinkshuComposition";
import type { Translate } from "../../../i18n";
import {
  activeTopupAtom,
  topupAmountAtom,
  topupInvoiceBusyAtom,
  topupInvoiceCashuRequestAtom,
  topupInvoiceErrorAtom,
  topupInvoiceQrPayloadAtom,
  topupNoteAtom,
} from "../../state/wallet/topup";
import { receivedPaymentRequestIdsAtom } from "../../state/wallet/tokenActivity";

const describeTopupError = (error: TopupError): string =>
  describeTaggedCashuError(error) ?? error._tag;

interface UseTopupFlowParams {
  defaultMintUrl: string | null;
  formatDisplayedAmountParts: (amountSat: number) => DisplayAmountParts;
  logPaymentEvent: (event: LoggedPaymentEventParams) => void;
  /** The user's mints the QR's cashu request offers after the topup's own. */
  requestMintUrls: readonly string[];
  /** Null until the linkshu runtime is composed (seed + owners resolved). */
  resumePendingCashuTopups: ResumePendingCashuTopups | null;
  routeKind: Route["kind"];
  showPaidOverlay: (title?: string, details?: PaidOverlayDetails) => void;
  /** Null until the linkshu runtime is composed (seed + owners resolved). */
  startCashuTopup: StartCashuTopup | null;
  t: Translate;
  topupRecipientNprofile: string | null;
}

/**
 * The Lightning topup vertical over linkshu Topup: entering the invoice
 * route starts a topup (quote + invoice + QR with an embedded cashu payment
 * request), linkshu's settlement poll completes it in the background even
 * after navigating away, and interrupted topups self-recover through
 * `resumePending` when the runtime comes up and whenever the browser comes
 * back online. Pending quotes are retired only by the mint's own answer.
 */
export const useTopupFlow = ({
  defaultMintUrl,
  formatDisplayedAmountParts,
  logPaymentEvent,
  requestMintUrls,
  resumePendingCashuTopups,
  routeKind,
  showPaidOverlay,
  startCashuTopup,
  t,
  topupRecipientNprofile,
}: UseTopupFlowParams) => {
  const [activeTopup, setActiveTopup] = useAtom(activeTopupAtom);
  const [topupAmount, setTopupAmount] = useAtom(topupAmountAtom);
  const [topupNote, setTopupNote] = useAtom(topupNoteAtom);
  const setTopupInvoiceError = useAtomSet(topupInvoiceErrorAtom);
  const setTopupInvoiceIsBusy = useAtomSet(topupInvoiceBusyAtom);
  const setTopupInvoiceQrPayload = useAtomSet(topupInvoiceQrPayloadAtom);
  const setTopupInvoiceCashuRequest = useAtomSet(topupInvoiceCashuRequestAtom);
  const topupPaidNavTimerRef = React.useRef<number | null>(null);

  React.useEffect(
    () => () => {
      if (topupPaidNavTimerRef.current !== null) {
        window.clearTimeout(topupPaidNavTimerRef.current);
      }
      topupPaidNavTimerRef.current = null;
    },
    [],
  );

  const activeTopupRef = useLatest(activeTopup);
  const routeKindRef = useLatest(routeKind);
  const tRef = useLatest(t);

  /** Quotes already celebrated, so a second signal cannot double-finalize. */
  const finalizedQuoteIdsRef = React.useRef<Set<string>>(new Set());
  /** Quotes with a live completion continuation attached. */
  const watchedQuoteIdsRef = React.useRef<Set<string>>(new Set());
  /** `mint|amount|note` of the start request currently being applied. */
  const startedKeyRef = React.useRef<string | null>(null);
  /** The note typed for each quote; a resumed quote has only its invoice. */
  const noteByQuoteIdRef = React.useRef<Map<string, string>>(new Map());

  /** Takes the invoice screen down once its topup got paid either way. */
  const closeActiveTopup = React.useCallback(
    (quote: TopupQuote) => {
      const active = activeTopupRef.current;
      if (active === null || active.quote.quoteId !== quote.quoteId) return;
      setActiveTopup(null);
      setTopupAmount("");
      setTopupNote("");
      startedKeyRef.current = null;
      if (routeKindRef.current !== "topupInvoice") return;
      if (topupPaidNavTimerRef.current !== null) {
        window.clearTimeout(topupPaidNavTimerRef.current);
      }
      topupPaidNavTimerRef.current = window.setTimeout(() => {
        topupPaidNavTimerRef.current = null;
        // The user may have navigated elsewhere during the celebration delay;
        // yanking them to the wallet then would stomp their navigation.
        if (routeKindRef.current !== "topupInvoice") return;
        navigateTo({ route: "wallet" });
      }, 1400);
    },
    [
      activeTopupRef,
      routeKindRef,
      setActiveTopup,
      setTopupAmount,
      setTopupNote,
    ],
  );

  const completeTopup = React.useCallback(
    (quote: TopupQuote, gainedToken: string | null) => {
      if (finalizedQuoteIdsRef.current.has(quote.quoteId)) return;
      finalizedQuoteIdsRef.current.add(quote.quoteId);

      const invoicePreview = getLightningInvoicePreview(quote.invoice);
      logPaymentEvent({
        amount: quote.amount,
        details: {
          ...(gainedToken ? { gainedToken } : {}),
          lightningInvoice: quote.invoice,
        },
        direction: "in",
        method: "lightning_invoice",
        mint: quote.mint,
        note:
          noteByQuoteIdRef.current.get(quote.quoteId) ??
          invoicePreview?.description ??
          null,
        status: "ok",
        transactionId: transactionIdForQuote(
          "topup",
          quote.mint,
          quote.quoteId,
        ),
        unit: "sat",
      });

      const displayAmount = formatDisplayedAmountParts(quote.amount);
      showPaidOverlay(
        t("topupOverlay")
          .replace(
            "{amount}",
            `${displayAmount.approxPrefix}${displayAmount.amountText}`,
          )
          .replace("{unit}", displayAmount.unitLabel),
        { direction: "in", amountSat: quote.amount },
      );
      closeActiveTopup(quote);
    },
    [
      closeActiveTopup,
      formatDisplayedAmountParts,
      logPaymentEvent,
      showPaidOverlay,
      t,
    ],
  );

  const failTopup = React.useCallback(
    (quote: TopupQuote, error: TopupError) => {
      const active = activeTopupRef.current;
      const isActive =
        active !== null && active.quote.quoteId === quote.quoteId;
      // The poll gave up while offline; the persisted quote stays claimable
      // and the `online` resume re-attaches it, so the invoice stays up.
      if (error._tag === "MintUnreachable") return;
      console.warn("[linky][topup] topup ended without minting", {
        error: error._tag,
        mint: quote.mint,
        quoteId: quote.quoteId,
      });
      if (!isActive) return;
      setActiveTopup(null);
      startedKeyRef.current = null;
      if (error._tag !== "QuoteExpired") {
        setTopupInvoiceError(
          `${t("topupInvoiceFailed")}: ${describeTopupError(error)}`,
        );
      }
    },
    [activeTopupRef, setActiveTopup, setTopupInvoiceError, t],
  );

  const completeTopupRef = useLatest(completeTopup);
  const failTopupRef = useLatest(failTopup);

  const watchTopup = React.useCallback(
    (handle: CashuTopupHandle) => {
      const quoteId = handle.quote.quoteId;
      if (watchedQuoteIdsRef.current.has(quoteId)) return;
      watchedQuoteIdsRef.current.add(quoteId);
      void handle.completion
        .then((result) => {
          if (Result.isSuccess(result)) {
            completeTopupRef.current(handle.quote, result.success.tokenText);
          } else {
            failTopupRef.current(handle.quote, result.failure);
          }
        })
        .catch(() => {
          // Runtime shut down mid-flight; the pending record resumes later.
        })
        .finally(() => {
          watchedQuoteIdsRef.current.delete(quoteId);
        });
    },
    [completeTopupRef, failTopupRef],
  );

  useResumeOnLaunchAndOnline(
    React.useMemo(() => {
      if (resumePendingCashuTopups === null) return null;
      return () => {
        void resumePendingCashuTopups()
          .then((handles) => {
            for (const handle of handles) watchTopup(handle);
          })
          .catch((error: unknown) => {
            console.warn("[linky][topup] resumePending failed", error);
          });
      };
    }, [resumePendingCashuTopups, watchTopup]),
  );

  React.useEffect(() => {
    if (routeKind !== "topupInvoice" || startCashuTopup === null) return;

    const amountSat = Number.parseInt(topupAmount.trim(), 10);
    if (!Number.isFinite(amountSat) || amountSat <= 0) {
      setTopupInvoiceError(null);
      setTopupInvoiceIsBusy(false);
      return;
    }

    const mint = normalizeMintUrl(defaultMintUrl ?? MAIN_MINT_URL);
    if (!mint) {
      setTopupInvoiceError(tRef.current("topupInvoiceFailed"));
      setTopupInvoiceIsBusy(false);
      return;
    }

    const note = topupNote.trim() || null;
    if (
      activeTopup !== null &&
      activeTopup.amountSat === amountSat &&
      activeTopup.mint === mint &&
      activeTopup.note === note
    ) {
      return;
    }

    // A failed start keeps its key, so retrying takes a changed amount or a
    // route re-entry — never an effect-rerun loop of fresh quotes.
    const requestKey = `${mint}|${amountSat}|${note ?? ""}`;
    if (startedKeyRef.current === requestKey) return;
    startedKeyRef.current = requestKey;
    setTopupInvoiceError(null);
    setTopupInvoiceIsBusy(true);

    void startCashuTopup({
      amountSat,
      mint,
      ...(note ? { description: note } : {}),
    }).then(
      (outcome) => {
        if (Result.isSuccess(outcome)) {
          if (note)
            noteByQuoteIdRef.current.set(outcome.success.quote.quoteId, note);
          watchTopup(outcome.success);
        }
        // A newer request supersedes this one; the quote stays watched.
        if (startedKeyRef.current !== requestKey) return;
        if (Result.isSuccess(outcome)) {
          setActiveTopup({
            amountSat,
            mint,
            note,
            quote: outcome.success.quote,
            requestId: PaymentRequestId.make(makeLocalId()),
          });
        } else {
          setTopupInvoiceError(
            `${tRef.current("topupInvoiceFailed")}: ${describeTopupError(outcome.failure)}`,
          );
        }
        setTopupInvoiceIsBusy(false);
      },
      (error: unknown) => {
        if (startedKeyRef.current !== requestKey) return;
        console.warn("[linky][topup] topup start failed", error);
        setTopupInvoiceError(tRef.current("topupInvoiceFailed"));
        setTopupInvoiceIsBusy(false);
      },
    );
  }, [
    activeTopup,
    defaultMintUrl,
    routeKind,
    setActiveTopup,
    setTopupInvoiceError,
    setTopupInvoiceIsBusy,
    startCashuTopup,
    tRef,
    topupAmount,
    topupNote,
    watchTopup,
  ]);

  React.useEffect(() => {
    if (routeKind !== "topupInvoice" || activeTopup === null) {
      setTopupInvoiceQrPayload(null);
      setTopupInvoiceCashuRequest(null);
      return;
    }

    const invoice: string = activeTopup.quote.invoice;
    const cashuRequest = topupRecipientNprofile
      ? buildCashuPaymentRequestMessage({
          amount: activeTopup.amountSat,
          description: activeTopup.note,
          mintUrls: [activeTopup.mint, ...requestMintUrls],
          recipientNprofile: topupRecipientNprofile,
          requestId: activeTopup.requestId,
        })
      : null;
    const payload = cashuRequest
      ? (buildBip321PaymentUri({ creq: cashuRequest, lightning: invoice }) ??
        invoice)
      : invoice;
    setTopupInvoiceCashuRequest(cashuRequest);
    setTopupInvoiceQrPayload(payload);
  }, [
    activeTopup,
    requestMintUrls,
    routeKind,
    setTopupInvoiceCashuRequest,
    setTopupInvoiceQrPayload,
    topupRecipientNprofile,
  ]);

  React.useEffect(() => {
    if (routeKind === "topupInvoice") return;
    startedKeyRef.current = null;
    setTopupInvoiceError(null);
    setTopupInvoiceIsBusy(false);
    if (routeKind !== "topup" && activeTopupRef.current === null) {
      setTopupAmount("");
      setTopupNote("");
    }
  }, [
    activeTopupRef,
    routeKind,
    setTopupAmount,
    setTopupInvoiceError,
    setTopupInvoiceIsBusy,
    setTopupNote,
  ]);

  // The QR's cashu request is paid by a payload naming its request id; the
  // receive already celebrated it, and the unpaid quote is retired later by
  // linkshu on the mint's own answer.
  const receivedPaymentRequestIds = useAtomValue(receivedPaymentRequestIdsAtom);
  React.useEffect(() => {
    if (activeTopup === null) return;
    if (!receivedPaymentRequestIds.has(activeTopup.requestId)) return;
    reportAppLog({
      tag: "topup.paidByCashuRequest",
      summary: "A cashu payment of the topup QR's request arrived",
      links: {
        paymentRequest: activeTopup.requestId,
        quote: activeTopup.quote.quoteId,
      },
      payload: null,
    });
    closeActiveTopup(activeTopup.quote);
  }, [activeTopup, closeActiveTopup, receivedPaymentRequestIds]);

  /**
   * Starts a topup that never touches the invoice-page state — for flows
   * that hand the invoice elsewhere (LNURL withdraw). Completion still shows
   * the paid overlay and logs the payment event.
   */
  const startBackgroundTopup = React.useCallback(
    async (args: {
      amountSat: number;
      mint: string;
    }): Promise<Result.Result<TopupQuote, string>> => {
      if (startCashuTopup === null) {
        return Result.fail(t("topupInvoiceFailed"));
      }
      const outcome = await startCashuTopup(args);
      if (Result.isFailure(outcome)) {
        return Result.fail(describeTopupError(outcome.failure));
      }
      watchTopup(outcome.success);
      return Result.succeed(outcome.success.quote);
    },
    [startCashuTopup, t, watchTopup],
  );

  return { startBackgroundTopup };
};

/** The topup screens' view of the flow `useTopupFlow` runs. */
export const useTopupInvoice = () => {
  const [topupAmount, setTopupAmount] = useAtom(topupAmountAtom);
  const [topupNote, setTopupNote] = useAtom(topupNoteAtom);
  const activeTopup = useAtomValue(activeTopupAtom);
  const topupInvoiceCashuRequest = useAtomValue(topupInvoiceCashuRequestAtom);
  const topupInvoiceError = useAtomValue(topupInvoiceErrorAtom);
  const topupInvoiceIsBusy = useAtomValue(topupInvoiceBusyAtom);
  const topupInvoiceQrPayload = useAtomValue(topupInvoiceQrPayloadAtom);
  return {
    setTopupAmount,
    setTopupNote,
    topupAmount,
    topupNote,
    topupInvoice: activeTopup?.quote.invoice ?? null,
    topupInvoiceCashuRequest,
    topupInvoiceError,
    topupInvoiceIsBusy,
    topupInvoiceQrPayload,
    topupMintUrl: activeTopup?.mint ?? null,
  };
};
