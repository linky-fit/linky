import type { MeltError, MeltReceipt, PaymentPending } from "@linky/linkshu";
import { Either } from "effect";
import React from "react";
import {
  fetchLnurlInvoiceForTarget,
  getLnurlPayDisplayText,
  inferLightningAddressFromLnurlTarget,
  type LnurlPaySuccessAction,
} from "../../lnurlPay";
import { CONTACTS_ONBOARDING_HAS_PAID_STORAGE_KEY } from "../../utils/constants";
import type { DisplayAmountParts } from "../../utils/displayAmounts";
import {
  buildPaymentAmountAttempts,
  buildPaymentFailureAmountAttempts,
  getLightningInvoicePreview,
  isRetryablePaymentAmountFailure,
  type LightningInvoicePreview,
} from "@linky/linkshu";
import { normalizeMintUrl } from "../../utils/mint";
import { safeLocalStorageSet } from "../../utils/storage";
import { getUnknownErrorMessage } from "../../utils/unknown";
import { describeTaggedCashuError } from "../lib/cashuStoredError";
import { selectSendMintForAmount } from "../lib/paymentMintSelection";
import type { SendMintBalance } from "../lib/paymentMintSelection";
import type {
  ContactPayRowLike,
  LoggedPaymentEventParams,
  PaymentTelemetryMethod,
} from "../types/appTypes";
import type { JsonValue } from "../../types/json";
import type { MeltCashuInvoice } from "./composition/useLinkshuComposition";
import type { Translate } from "../../i18n";

const describeMeltError = (error: MeltError): string =>
  describeTaggedCashuError(error) ?? error._tag;

interface MeltFailure {
  readonly message: string;
  /** The melt was sent and the mint has not settled it; not a failure yet. */
  readonly pending: PaymentPending | null;
}

interface UseLightningPaymentsDomainParams {
  canPayWithCashu: boolean;
  cashuBalance: number;
  cashuIsBusy: boolean;
  contacts: readonly ContactPayRowLike[];
  defaultMintUrl: string | null;
  formatDisplayedAmountParts: (amountSat: number) => DisplayAmountParts;
  logPaymentEvent: (event: LoggedPaymentEventParams) => void;
  /** Null until the linkshu runtime is composed (seed + owners resolved). */
  meltCashuInvoice: MeltCashuInvoice | null;
  setCashuIsBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setContactsOnboardingHasPaid: React.Dispatch<React.SetStateAction<boolean>>;
  setPostPaySaveContact: React.Dispatch<
    React.SetStateAction<{ amountSat: number; lnAddress: string } | null>
  >;
  setStatus: React.Dispatch<React.SetStateAction<string | null>>;
  showPaidOverlay: (title?: string) => void;
  t: Translate;
  /** Per-mint spendable balances from the linkshu read model. */
  walletMintBalances: readonly SendMintBalance[];
}

/**
 * Lightning payments from the cashu balance through linkshu Melt. The app
 * picks the mint, resolves LN addresses via LNURL, and records payment
 * history; linkshu owns proof selection, the melt itself, and persisting
 * change — a failed melt leaves the balance intact, so amount-degrade
 * retries never need recovery bookkeeping. A melt the mint has not settled
 * is history as a `pending` payment keyed by its melt quote id, which
 * `useMeltRecovery` updates once linkshu settles the record.
 */
export const useLightningPaymentsDomain = ({
  canPayWithCashu,
  cashuBalance,
  cashuIsBusy,
  contacts,
  defaultMintUrl,
  formatDisplayedAmountParts,
  logPaymentEvent,
  meltCashuInvoice,
  setCashuIsBusy,
  setContactsOnboardingHasPaid,
  setPostPaySaveContact,
  setStatus,
  showPaidOverlay,
  t,
  walletMintBalances,
}: UseLightningPaymentsDomainParams) => {
  const rememberFirstPayment = React.useCallback(() => {
    safeLocalStorageSet(CONTACTS_ONBOARDING_HAS_PAID_STORAGE_KEY, "1");
    setContactsOnboardingHasPaid(true);
  }, [setContactsOnboardingHasPaid]);

  const meltOnMint = React.useCallback(
    async (
      melt: MeltCashuInvoice,
      invoice: string,
      mint: string,
    ): Promise<Either.Either<MeltReceipt, MeltFailure>> => {
      try {
        const outcome = await melt({ invoice, mint });
        if (Either.isRight(outcome)) return Either.right(outcome.right);
        return Either.left({
          message: describeMeltError(outcome.left),
          pending: outcome.left._tag === "PaymentPending" ? outcome.left : null,
        });
      } catch (error) {
        return Either.left({
          message: getUnknownErrorMessage(error, "unknown"),
          pending: null,
        });
      }
    },
    [],
  );

  const recordPendingMelt = React.useCallback(
    (
      pending: PaymentPending,
      method: PaymentTelemetryMethod,
      details: Record<string, JsonValue>,
      contactId: string | null,
    ) => {
      logPaymentEvent({
        direction: "out",
        status: "ok",
        amount: pending.amount,
        details: { ...details, meltQuoteId: pending.quoteId },
        fee: null,
        mint: pending.mint,
        unit: "sat",
        error: null,
        contactId,
        method,
        phase: "melt",
      });
      setStatus(t("payPending"));
      rememberFirstPayment();
    },
    [logPaymentEvent, rememberFirstPayment, setStatus, t],
  );

  const payLightningInvoiceWithCashu = React.useCallback(
    async (invoice: string) => {
      const normalized = invoice.trim();
      if (!normalized) return false;

      if (cashuIsBusy) return false;
      if (cashuBalance <= 0) {
        setStatus(t("payInsufficient"));
        return false;
      }
      if (meltCashuInvoice === null) {
        setStatus(`${t("errorPrefix")}: Cashu storage is not ready`);
        return false;
      }

      setCashuIsBusy(true);
      try {
        const invoicePreview = getLightningInvoicePreview(normalized);
        const invoiceAmountSat = invoicePreview?.amountSat ?? null;
        // An amountless invoice cannot pre-select by size; any funded mint
        // may quote it, so fall back to the 1-sat threshold.
        const mint = selectSendMintForAmount(
          walletMintBalances,
          normalizeMintUrl(defaultMintUrl ?? ""),
          invoiceAmountSat ?? 1,
        );
        if (mint === null) {
          setStatus(t("payInsufficient"));
          return false;
        }

        const invoiceDetails = {
          lightningInvoice: normalized,
          ...(invoicePreview?.description
            ? { lightningMemo: invoicePreview.description }
            : {}),
        };
        const outcome = await meltOnMint(meltCashuInvoice, normalized, mint);

        if (Either.isLeft(outcome)) {
          if (outcome.left.pending !== null) {
            recordPendingMelt(
              outcome.left.pending,
              "lightning_invoice",
              invoiceDetails,
              null,
            );
            return true;
          }
          logPaymentEvent({
            direction: "out",
            status: "error",
            amount: null,
            details: invoiceDetails,
            fee: null,
            mint,
            unit: "sat",
            error: outcome.left.message,
            contactId: null,
            method: "lightning_invoice",
            phase: "melt",
          });
          setStatus(`${t("payFailed")}: ${outcome.left.message}`);
          return false;
        }

        const receipt = outcome.right;
        logPaymentEvent({
          direction: "out",
          status: "ok",
          amount: receipt.paidAmount,
          details: invoiceDetails,
          fee: receipt.feePaid,
          mint: receipt.mint,
          unit: "sat",
          error: null,
          contactId: null,
          method: "lightning_invoice",
          phase: "complete",
        });

        const displayAmount = formatDisplayedAmountParts(receipt.paidAmount);
        showPaidOverlay(
          t("paidSent")
            .replace(
              "{amount}",
              `${displayAmount.approxPrefix}${displayAmount.amountText}`,
            )
            .replace("{unit}", displayAmount.unitLabel),
        );
        rememberFirstPayment();
        return true;
      } finally {
        setCashuIsBusy(false);
      }
    },
    [
      cashuBalance,
      cashuIsBusy,
      defaultMintUrl,
      formatDisplayedAmountParts,
      logPaymentEvent,
      meltCashuInvoice,
      meltOnMint,
      recordPendingMelt,
      rememberFirstPayment,
      setCashuIsBusy,
      setStatus,
      showPaidOverlay,
      t,
      walletMintBalances,
    ],
  );

  const payLightningAddressWithCashu = React.useCallback(
    async (lnAddress: string, amountSat: number) => {
      const paymentTarget = lnAddress.trim();
      if (!paymentTarget) return false;
      if (!Number.isFinite(amountSat) || amountSat <= 0) {
        setStatus(`${t("errorPrefix")}: ${t("payInvalidAmount")}`);
        return false;
      }
      if (!canPayWithCashu) return false;
      if (cashuIsBusy) return false;
      if (meltCashuInvoice === null) {
        setStatus(`${t("errorPrefix")}: Cashu storage is not ready`);
        return false;
      }
      setCashuIsBusy(true);

      const displayTarget = getLnurlPayDisplayText(paymentTarget);
      let resolvedLightningAddress =
        inferLightningAddressFromLnurlTarget(paymentTarget);

      try {
        const mint = selectSendMintForAmount(
          walletMintBalances,
          normalizeMintUrl(defaultMintUrl ?? ""),
          amountSat,
        );
        if (mint === null) {
          setStatus(t("payInsufficient"));
          return false;
        }
        const mintBalance =
          walletMintBalances.find((entry) => entry.mint === mint)?.amount ?? 0;

        // Paying the full balance leaves no headroom for fees; the ladder
        // degrades the requested LNURL amount until amount + fees fit.
        const queuedAmountAttempts = buildPaymentAmountAttempts(
          amountSat,
          mintBalance,
        );
        const seenAmountAttempts = new Set(queuedAmountAttempts);
        let finalErrorMessage: string | null = null;
        let finalErrorMint: string | null = null;
        let lastAttemptInvoice: string | null = null;
        let lastAttemptInvoicePreview: LightningInvoicePreview | null = null;

        for (
          let attemptIndex = 0;
          attemptIndex < queuedAmountAttempts.length;
          attemptIndex += 1
        ) {
          const attemptedAmountSat = queuedAmountAttempts[attemptIndex];
          const canRetryLower = (errorMessage: string): boolean => {
            if (!isRetryablePaymentAmountFailure(errorMessage)) return false;
            for (const retryAmountSat of buildPaymentFailureAmountAttempts(
              attemptedAmountSat,
              errorMessage,
            )) {
              if (seenAmountAttempts.has(retryAmountSat)) continue;
              seenAmountAttempts.add(retryAmountSat);
              queuedAmountAttempts.push(retryAmountSat);
            }
            return attemptIndex < queuedAmountAttempts.length - 1;
          };

          let attemptInvoice: string;
          let attemptInvoicePreview: LightningInvoicePreview | null = null;
          let attemptSuccessAction: LnurlPaySuccessAction | null = null;
          try {
            const invoiceResult = await fetchLnurlInvoiceForTarget(
              paymentTarget,
              attemptedAmountSat,
            );
            if (invoiceResult.lightningAddress) {
              resolvedLightningAddress = invoiceResult.lightningAddress;
            }
            attemptInvoice = invoiceResult.pr;
            attemptSuccessAction = invoiceResult.successAction;
            attemptInvoicePreview = getLightningInvoicePreview(attemptInvoice);
            lastAttemptInvoice = attemptInvoice;
            lastAttemptInvoicePreview = attemptInvoicePreview;
          } catch (error) {
            const errorMessage = getUnknownErrorMessage(error, "unknown");
            if (canRetryLower(errorMessage)) continue;
            finalErrorMessage = errorMessage;
            finalErrorMint = null;
            break;
          }

          const outcome = await meltOnMint(
            meltCashuInvoice,
            attemptInvoice,
            mint,
          );

          const paidLightningAddress = resolvedLightningAddress;
          const knownContact = paidLightningAddress
            ? contacts.find(
                (contact) =>
                  (contact.lnAddress ?? "").trim().toLowerCase() ===
                  paidLightningAddress.toLowerCase(),
              )
            : null;

          if (Either.isLeft(outcome)) {
            if (outcome.left.pending !== null) {
              recordPendingMelt(
                outcome.left.pending,
                "lightning_address",
                {
                  lightningAddress: paidLightningAddress,
                  lightningInvoice: attemptInvoice,
                  ...(attemptInvoicePreview?.description
                    ? { lightningMemo: attemptInvoicePreview.description }
                    : {}),
                },
                knownContact?.id ?? null,
              );
              return true;
            }
            if (canRetryLower(outcome.left.message)) continue;
            finalErrorMessage = outcome.left.message;
            finalErrorMint = mint;
            break;
          }

          const receipt = outcome.right;
          const successActionMessage =
            attemptSuccessAction?.tag === "message"
              ? attemptSuccessAction.message
              : null;
          const successActionUrl =
            attemptSuccessAction?.tag === "url"
              ? attemptSuccessAction.url
              : null;
          const successActionUrlDescription =
            attemptSuccessAction?.tag === "url"
              ? attemptSuccessAction.description
              : null;

          logPaymentEvent({
            direction: "out",
            status: "ok",
            amount: receipt.paidAmount,
            details: {
              lightningAddress: paidLightningAddress,
              lightningInvoice: attemptInvoice,
              ...(attemptInvoicePreview?.description
                ? { lightningMemo: attemptInvoicePreview.description }
                : {}),
              ...(successActionMessage
                ? { lnurlSuccessMessage: successActionMessage }
                : {}),
              ...(successActionUrl
                ? { lnurlSuccessUrl: successActionUrl }
                : {}),
              ...(successActionUrlDescription
                ? { lnurlSuccessUrlDescription: successActionUrlDescription }
                : {}),
            },
            fee: receipt.feePaid,
            mint: receipt.mint,
            unit: "sat",
            error: null,
            contactId: knownContact?.id ?? null,
            method: "lightning_address",
            phase: "complete",
          });

          const displayAmount = formatDisplayedAmountParts(receipt.paidAmount);
          showPaidOverlay(
            t("paidSentTo")
              .replace(
                "{amount}",
                `${displayAmount.approxPrefix}${displayAmount.amountText}`,
              )
              .replace("{unit}", displayAmount.unitLabel)
              .replace(
                "{name}",
                (knownContact?.name ?? "").trim() || displayTarget,
              ),
          );

          if (successActionMessage) {
            setStatus(
              t("lnurlSuccessActionMessage").replace(
                "{message}",
                successActionMessage,
              ),
            );
          } else if (successActionUrl) {
            setStatus(
              t("lnurlSuccessActionUrl")
                .replace("{description}", successActionUrlDescription ?? "")
                .replace("{url}", successActionUrl),
            );
          }

          rememberFirstPayment();

          if (paidLightningAddress && !knownContact?.id) {
            setPostPaySaveContact({
              lnAddress: paidLightningAddress,
              amountSat: receipt.paidAmount,
            });
          }
          return true;
        }

        finalErrorMessage ??= "unknown";
        logPaymentEvent({
          direction: "out",
          status: "error",
          amount: amountSat,
          details: {
            lightningAddress: resolvedLightningAddress,
            ...(lastAttemptInvoice
              ? { lightningInvoice: lastAttemptInvoice }
              : {}),
            ...(lastAttemptInvoicePreview?.description
              ? { lightningMemo: lastAttemptInvoicePreview.description }
              : {}),
          },
          fee: null,
          mint: finalErrorMint,
          unit: "sat",
          error: finalErrorMessage,
          contactId:
            contacts.find(
              (contact) =>
                resolvedLightningAddress !== null &&
                (contact.lnAddress ?? "").trim().toLowerCase() ===
                  resolvedLightningAddress.toLowerCase(),
            )?.id ?? null,
          method: "lightning_address",
          phase: finalErrorMint ? "melt" : "invoice_fetch",
        });
        setStatus(`${t("payFailed")}: ${finalErrorMessage}`);
        return false;
      } finally {
        setCashuIsBusy(false);
      }
    },
    [
      canPayWithCashu,
      cashuIsBusy,
      contacts,
      defaultMintUrl,
      formatDisplayedAmountParts,
      logPaymentEvent,
      meltCashuInvoice,
      meltOnMint,
      recordPendingMelt,
      rememberFirstPayment,
      setCashuIsBusy,
      setPostPaySaveContact,
      setStatus,
      showPaidOverlay,
      t,
      walletMintBalances,
    ],
  );

  return {
    payLightningAddressWithCashu,
    payLightningInvoiceWithCashu,
  };
};
