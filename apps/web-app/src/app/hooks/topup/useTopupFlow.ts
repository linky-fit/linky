import type { TopupError, TopupQuote } from "@linky/linkshu";
import { Either } from "effect";
import React from "react";
import { useLatest } from "../../../hooks/useLatest";
import { navigateTo } from "../../../hooks/useRouting";
import type { Route } from "../../../types/route";
import { buildBip321PaymentUri } from "../../../utils/bip321";
import type { DisplayAmountParts } from "../../../utils/displayAmounts";
import { getLightningInvoicePreview } from "@linky/linkshu";
import { MAIN_MINT_URL, normalizeMintUrl } from "../../../utils/mint";
import { optimizeCaseInsensitiveQrPayload } from "../../../utils/qrPayload";
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

const describeTopupError = (error: TopupError): string =>
  describeTaggedCashuError(error) ?? error._tag;

interface ActiveTopup {
  readonly amountSat: number;
  readonly mint: string;
  readonly quote: TopupQuote;
}

interface UseTopupFlowParams {
  cashuTotalBalance: number;
  defaultMintUrl: string | null;
  formatDisplayedAmountParts: (amountSat: number) => DisplayAmountParts;
  logPaymentEvent: (event: LoggedPaymentEventParams) => void;
  /** Null until the linkshu runtime is composed (seed + owners resolved). */
  resumePendingCashuTopups: ResumePendingCashuTopups | null;
  routeKind: Route["kind"];
  showPaidOverlay: (title?: string) => void;
  /** Null until the linkshu runtime is composed (seed + owners resolved). */
  startCashuTopup: StartCashuTopup | null;
  t: Translate;
  topupPaidNavTimerRef: React.MutableRefObject<number | null>;
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
  cashuTotalBalance,
  defaultMintUrl,
  formatDisplayedAmountParts,
  logPaymentEvent,
  resumePendingCashuTopups,
  routeKind,
  showPaidOverlay,
  startCashuTopup,
  t,
  topupPaidNavTimerRef,
  topupRecipientNprofile,
}: UseTopupFlowParams) => {
  const [activeTopup, setActiveTopup] = React.useState<ActiveTopup | null>(
    null,
  );
  const [topupAmount, setTopupAmount] = React.useState<string>("");
  const [topupInvoiceError, setTopupInvoiceError] = React.useState<
    string | null
  >(null);
  const [topupInvoiceIsBusy, setTopupInvoiceIsBusy] = React.useState(false);
  const [topupInvoiceQr, setTopupInvoiceQr] = React.useState<string | null>(
    null,
  );
  const [topupInvoiceQrPayload, setTopupInvoiceQrPayload] = React.useState<
    string | null
  >(null);
  const [topupInvoiceCashuRequest, setTopupInvoiceCashuRequest] =
    React.useState<string | null>(null);

  const activeTopupRef = useLatest(activeTopup);
  const routeKindRef = useLatest(routeKind);
  const tRef = useLatest(t);

  /** Quotes already celebrated, so a second signal cannot double-finalize. */
  const finalizedQuoteIdsRef = React.useRef<Set<string>>(new Set());
  /** Quotes with a live completion continuation attached. */
  const watchedQuoteIdsRef = React.useRef<Set<string>>(new Set());
  /** `mint|amount` of the start request currently being applied. */
  const startedKeyRef = React.useRef<string | null>(null);
  const startBalanceRef = React.useRef<number | null>(null);

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
          ...(invoicePreview?.description
            ? { lightningMemo: invoicePreview.description }
            : {}),
        },
        direction: "in",
        method: "lightning_invoice",
        mint: quote.mint,
        status: "ok",
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
      );

      const active = activeTopupRef.current;
      if (active === null || active.quote.quoteId !== quote.quoteId) return;
      setActiveTopup(null);
      setTopupAmount("");
      startedKeyRef.current = null;
      startBalanceRef.current = null;
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
      formatDisplayedAmountParts,
      logPaymentEvent,
      routeKindRef,
      showPaidOverlay,
      t,
      topupPaidNavTimerRef,
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
    [activeTopupRef, t],
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
          if (Either.isRight(result)) {
            completeTopupRef.current(handle.quote, result.right.tokenText);
          } else {
            failTopupRef.current(handle.quote, result.left);
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

    if (
      activeTopup !== null &&
      activeTopup.amountSat === amountSat &&
      activeTopup.mint === mint
    ) {
      return;
    }

    // A failed start keeps its key, so retrying takes a changed amount or a
    // route re-entry — never an effect-rerun loop of fresh quotes.
    const requestKey = `${mint}|${amountSat}`;
    if (startedKeyRef.current === requestKey) return;
    startedKeyRef.current = requestKey;
    setTopupInvoiceError(null);
    setTopupInvoiceIsBusy(true);

    void startCashuTopup({ amountSat, mint }).then(
      (outcome) => {
        if (Either.isRight(outcome)) watchTopup(outcome.right);
        // A newer request supersedes this one; the quote stays watched.
        if (startedKeyRef.current !== requestKey) return;
        if (Either.isRight(outcome)) {
          startBalanceRef.current = null;
          setActiveTopup({ amountSat, mint, quote: outcome.right.quote });
        } else {
          setTopupInvoiceError(
            `${tRef.current("topupInvoiceFailed")}: ${describeTopupError(outcome.left)}`,
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
    startCashuTopup,
    tRef,
    topupAmount,
    watchTopup,
  ]);

  React.useEffect(() => {
    if (routeKind !== "topupInvoice" || activeTopup === null) {
      setTopupInvoiceQr(null);
      setTopupInvoiceQrPayload(null);
      setTopupInvoiceCashuRequest(null);
      return;
    }

    const invoice: string = activeTopup.quote.invoice;
    const cashuRequest = topupRecipientNprofile
      ? buildCashuPaymentRequestMessage({
          amount: activeTopup.amountSat,
          mintUrls: [activeTopup.mint],
          recipientNprofile: topupRecipientNprofile,
          requestId: activeTopup.quote.quoteId,
        })
      : null;
    const payload = cashuRequest
      ? (buildBip321PaymentUri({ creq: cashuRequest, lightning: invoice }) ??
        invoice)
      : invoice;
    setTopupInvoiceCashuRequest(cashuRequest);
    setTopupInvoiceQrPayload(payload);

    let cancelled = false;
    void (async () => {
      const QRCode = await import("qrcode");
      const qrPayload =
        payload === invoice
          ? optimizeCaseInsensitiveQrPayload(payload)
          : payload;
      const qr = await QRCode.toDataURL(qrPayload, { margin: 1, width: 320 });
      if (!cancelled) setTopupInvoiceQr(qr);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTopup, routeKind, topupRecipientNprofile]);

  React.useEffect(() => {
    if (routeKind === "topupInvoice") return;
    startedKeyRef.current = null;
    startBalanceRef.current = null;
    setTopupInvoiceError(null);
    setTopupInvoiceIsBusy(false);
    if (routeKind !== "topup" && activeTopupRef.current === null) {
      setTopupAmount("");
    }
  }, [activeTopupRef, routeKind]);

  // The QR also carries a cashu payment request, so the sats can arrive as a
  // token instead of an invoice payment: a balance jump by the requested
  // amount finalizes the topup UI even though the mint quote stays unpaid
  // (linkshu retires it later on the mint's own answer).
  React.useEffect(() => {
    if (routeKind !== "topupInvoice" || activeTopup === null) return;
    if (startBalanceRef.current === null) {
      startBalanceRef.current = cashuTotalBalance;
      return;
    }
    if (cashuTotalBalance >= startBalanceRef.current + activeTopup.amountSat) {
      completeTopupRef.current(activeTopup.quote, null);
    }
  }, [activeTopup, cashuTotalBalance, completeTopupRef, routeKind]);

  /**
   * Starts a topup that never touches the invoice-page state — for flows
   * that hand the invoice elsewhere (LNURL withdraw). Completion still shows
   * the paid overlay and logs the payment event.
   */
  const startBackgroundTopup = React.useCallback(
    async (args: {
      amountSat: number;
      mint: string;
    }): Promise<Either.Either<TopupQuote, string>> => {
      if (startCashuTopup === null) {
        return Either.left(t("topupInvoiceFailed"));
      }
      const outcome = await startCashuTopup(args);
      if (Either.isLeft(outcome)) {
        return Either.left(describeTopupError(outcome.left));
      }
      watchTopup(outcome.right);
      return Either.right(outcome.right.quote);
    },
    [startCashuTopup, t, watchTopup],
  );

  return {
    setTopupAmount,
    startBackgroundTopup,
    topupAmount,
    topupInvoice: activeTopup?.quote.invoice ?? null,
    topupInvoiceCashuRequest,
    topupInvoiceError,
    topupInvoiceIsBusy,
    topupInvoiceQr,
    topupInvoiceQrPayload,
    topupMintUrl: activeTopup?.mint ?? null,
  };
};
