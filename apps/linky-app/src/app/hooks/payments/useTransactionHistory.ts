import { getLightningInvoicePreview } from "@linky-fit/linkshu";
import { useAtomValue } from "@linky-fit/linkstr-react";
import type { Tone } from "@linky-fit/ui";
import React from "react";
import type { Translate } from "../../../i18n";
import { formatInteger, formatTimeAgo } from "../../../utils/formatting";
import { asNonEmptyString } from "../../../utils/validation";
import { createCashuTokenId } from "../../lib/cashuTokenIdentity";
import {
  withOnchainTransfers,
  type HistoryEntry,
} from "../../lib/onchainTransferHistory";
import type { OnchainTransferView } from "../../lib/onchainTransfers";
import { describeRecurringInterval } from "../../lib/recurringPaymentDisplay";
import {
  buildTransactionHistory,
  deriveDeclinedRequestIds,
  isPaymentRequestTransaction,
  readJsonRecord,
  readRequestIdFromDetails,
  readStringArrayFromJson,
  type TransactionItem,
} from "../../lib/transactionHistory";
import { calculateTransactionHistoryFee } from "../../lib/transactionHistoryFee";
import { hiddenTransactionsShownAtom } from "../../state/shell/topbar";
import { useNostrPictureByNpub } from "../contacts/useProfileCache";
import { useDisplayAmounts, useTranslation } from "../shell";
import {
  useContactRows,
  useMessageRows,
  useTransactionRecords,
  useWalletOperations,
} from "../useLinksync";
import { useOnchainTransfers } from "../useOnchainTransfers";
import { useRecurringPaymentOrders } from "./useRecurringPaymentOrders";

export interface ContactSummary {
  id: string;
  lnAddress: string | null;
  name: string | null;
  npub: string | null;
}

export interface TransactionDetailValue {
  copyValue?: string;
  value: string;
}

export interface TransactionDetailEntry {
  label: string;
  values: TransactionDetailValue[];
}

export interface TransactionStatusPill {
  label: string;
  tone: Tone;
}

export type TransactionRequestStatus = "declined" | "paid" | "pending" | null;

const scoreContact = (contact: ContactSummary): number => {
  let score = 0;
  if (contact.name) score += 4;
  if (contact.npub) score += 2;
  if (contact.lnAddress) score += 1;
  return score;
};

const formatCompactToken = (value: string): string => {
  if (value.length <= 28) return value;
  return `${value.slice(0, 12)}...${value.slice(-12)}`;
};

const formatCompactLongString = (value: string): string => {
  if (value.length <= 20) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
};

/** What the paid LNURL service said, with its link when it gave one. */
export const readLnurlSuccessMessage = (
  item: TransactionItem,
): string | null => {
  const details = readJsonRecord(item.details);
  if (!details) return null;
  const message = asNonEmptyString(details.lnurlSuccessMessage);
  if (message) return message;
  const url = asNonEmptyString(details.lnurlSuccessUrl);
  if (!url) return null;
  const description = asNonEmptyString(details.lnurlSuccessUrlDescription);
  return description ? `${description} ${url}` : url;
};

export interface TransactionHistory {
  /** The history as listed, newest first, hidden transactions included only when shown. */
  readonly entries: readonly HistoryEntry[];
  /** Every transaction by id, the hidden ones too, so a detail page finds its own. */
  readonly transactionsById: ReadonlyMap<string, TransactionItem>;
  readonly pendingOnchainTransfers: readonly OnchainTransferView[];
  readonly hasScheduled: boolean;
  readonly contactsById: ReadonlyMap<string, ContactSummary>;
  readonly nostrPictureByNpub: Readonly<Record<string, string | null>>;
  /** Interval label of each live recurring payment, e.g. "monthly"; a deleted one has none. */
  readonly recurringIntervalById: ReadonlyMap<string, string>;
  readonly buildTitle: (item: TransactionItem) => string;
  readonly formatAmountText: (
    amount: number | null,
    unit: string | null,
  ) => string;
  readonly formatDateText: (createdAtSec: number) => string;
  readonly getRequestStatus: (
    item: TransactionItem,
  ) => TransactionRequestStatus;
  readonly buildProblemStatusPill: (
    item: TransactionItem,
    requestStatus: TransactionRequestStatus,
  ) => TransactionStatusPill | null;
  readonly buildDetailEntries: (
    item: TransactionItem,
  ) => TransactionDetailEntry[];
  readonly t: Translate;
}

/** The payment history with everything its list and its detail pages read and write about a transaction. */
export const useTransactionHistory = (): TransactionHistory => {
  const { lang, t } = useTranslation();
  const { formatDisplayedAmountText } = useDisplayAmounts();
  const nostrPictureByNpub = useNostrPictureByNpub();
  const showHiddenTransactions = useAtomValue(hiddenTransactionsShownAtom);

  const contactRows = useContactRows();
  const cashuOperations = useWalletOperations();
  const messageRows = useMessageRows();
  const transactionRecords = useTransactionRecords();
  const recurringOrders = useRecurringPaymentOrders();
  const recurringIntervalById = React.useMemo(
    () =>
      new Map(
        recurringOrders.map((order) => [
          order.id,
          describeRecurringInterval(order.schedule.interval, t),
        ]),
      ),
    [recurringOrders, t],
  );

  const tokenByReferenceId = React.useMemo(() => {
    const tokens = new Map<string, string>();
    for (const operation of cashuOperations) {
      if (operation.tokenText !== null)
        tokens.set(
          createCashuTokenId(operation.tokenText),
          operation.tokenText,
        );
    }
    return tokens;
  }, [cashuOperations]);

  const contactsById = React.useMemo(() => {
    const byId = new Map<string, ContactSummary>();
    for (const row of contactRows) {
      const id = asNonEmptyString(row.id);
      if (!id) continue;
      const candidate: ContactSummary = {
        id,
        lnAddress: asNonEmptyString(row.lnAddress),
        name: asNonEmptyString(row.name),
        npub: asNonEmptyString(row.npub),
      };
      const existing = byId.get(id);
      if (!existing || scoreContact(candidate) >= scoreContact(existing)) {
        byId.set(id, candidate);
      }
    }
    return byId;
  }, [contactRows]);

  const { fulfilledRequestIds, transactions: allTransactions } = React.useMemo(
    () => buildTransactionHistory(transactionRecords, cashuOperations),
    [cashuOperations, transactionRecords],
  );
  const transactionsById = React.useMemo(
    () => new Map(allTransactions.map((item) => [item.id, item])),
    [allTransactions],
  );
  const onchainTransfers = useOnchainTransfers();
  const { pending: pendingOnchainTransfers, entries } = React.useMemo(
    () =>
      withOnchainTransfers(
        showHiddenTransactions
          ? allTransactions
          : allTransactions.filter((item) => item.hiddenReason === null),
        onchainTransfers,
      ),
    [allTransactions, onchainTransfers, showHiddenTransactions],
  );

  const declinedRequestIds = React.useMemo(
    () => deriveDeclinedRequestIds(messageRows),
    [messageRows],
  );

  const buildTitle = React.useCallback(
    (item: TransactionItem): string => {
      if (isPaymentRequestTransaction(item)) return t("requestPaymentLabel");

      const contact = item.contactId ? contactsById.get(item.contactId) : null;
      if (contact) {
        return (
          contact.name ||
          contact.lnAddress ||
          (item.direction === "in"
            ? t("transactionReceivedFromContact")
            : t("transactionSentToContact"))
        );
      }
      if (item.category === "lightning") {
        if (item.direction === "in") {
          return item.method === "lightning_address"
            ? t("transactionTopupLnAddress")
            : t("transactionTopupInvoice");
        }
        return item.method === "lightning_address"
          ? t("transactionPaidLightningAddress")
          : t("transactionPaidLightningInvoice");
      }
      if (item.category === "contacts") {
        return item.direction === "in"
          ? t("transactionReceivedFromContact")
          : t("transactionSentToContact");
      }
      if (item.method === "cashu_receive") return t("transactionCashuInserted");
      if (item.method === "cashu_restore") return t("transactionCashuRestored");
      if (item.method === "cashu_emit") return t("transactionCashuSwap");
      return t("transactionCashuIssued");
    },
    [contactsById, t],
  );

  const formatDateText = React.useCallback(
    (createdAtSec: number): string => formatTimeAgo(createdAtSec, lang),
    [lang],
  );

  const formatAmountText = React.useCallback(
    (amount: number | null, unit: string | null): string => {
      if (amount === null) return "";
      if (unit && unit !== "sat") {
        return `${formatInteger(amount, lang)} ${unit}`;
      }
      return formatDisplayedAmountText(amount);
    },
    [formatDisplayedAmountText, lang],
  );

  const buildProblemStatusPill = React.useCallback(
    (
      item: TransactionItem,
      requestStatus: TransactionRequestStatus,
    ): TransactionStatusPill | null => {
      if (item.hiddenReason === "duplicate" || item.isReturned) {
        return {
          tone: "neutral",
          label: t(
            item.hiddenReason === "duplicate"
              ? "transactionDuplicate"
              : "transactionReturned",
          ),
        };
      }
      if (
        requestStatus === "pending" ||
        item.status === "pending" ||
        item.pendingLabel === "pending"
      ) {
        return {
          tone: "warning",
          label: t("transactionPending"),
        };
      }
      if (requestStatus === "declined") {
        return {
          tone: "neutral",
          label: t("paymentRequestStatusDeclined"),
        };
      }
      if (item.status === "error" || item.status === "declined") {
        return {
          tone: "danger",
          label: t("transactionFailed"),
        };
      }
      return null;
    },
    [t],
  );

  const getRequestStatus = React.useCallback(
    (item: TransactionItem): TransactionRequestStatus => {
      if (!isPaymentRequestTransaction(item)) return null;
      const requestId = readRequestIdFromDetails(item.details);
      if (!requestId) return null;
      if (fulfilledRequestIds.has(requestId)) return "paid";
      if (declinedRequestIds.has(requestId)) return "declined";
      return "pending";
    },
    [declinedRequestIds, fulfilledRequestIds],
  );

  const buildDetailEntries = React.useCallback(
    (item: TransactionItem): TransactionDetailEntry[] => {
      const details = readJsonRecord(item.details);
      const legacyUsedTokens = readStringArrayFromJson(
        details?.usedInputTokens,
      );
      const usedTokens = Array.from(
        new Set([
          ...legacyUsedTokens,
          ...readStringArrayFromJson(details?.usedTokenIds).flatMap((id) => {
            const token = tokenByReferenceId.get(id);
            return token ? [token] : [];
          }),
        ]),
      );
      const legacyGainedTokens = [
        asNonEmptyString(details?.gainedToken),
        asNonEmptyString(details?.acceptedToken),
      ].filter((value): value is string => value !== null);
      const gainedTokens = Array.from(
        new Set([
          ...legacyGainedTokens,
          ...readStringArrayFromJson(details?.gainedTokenIds).flatMap((id) => {
            const token = tokenByReferenceId.get(id);
            return token ? [token] : [];
          }),
        ]),
      );
      const fee =
        item.direction === "out"
          ? calculateTransactionHistoryFee({
              amount: item.amount,
              fallbackFee: item.fee,
              gainedTokens,
              usedTokens,
            })
          : null;
      const feeText = fee !== null ? formatAmountText(fee, item.unit) : "";
      const lightningInvoice = asNonEmptyString(details?.lightningInvoice);
      // Rows written before notes were stored only have the invoice to read
      // the description from.
      const lightningMemo =
        item.note === null && lightningInvoice
          ? (getLightningInvoicePreview(lightningInvoice)?.description ?? null)
          : null;
      const lightningPreimage = asNonEmptyString(details?.lightningPreimage);
      const lnurlSuccessMessage = asNonEmptyString(
        details?.lnurlSuccessMessage,
      );
      const lnurlSuccessUrl = asNonEmptyString(details?.lnurlSuccessUrl);
      const lnurlSuccessUrlDescription = asNonEmptyString(
        details?.lnurlSuccessUrlDescription,
      );

      return [
        ...(feeText
          ? [
              {
                label: t("paymentsHistoryFee"),
                values: [{ value: feeText }],
              },
            ]
          : []),
        ...(item.mint
          ? [
              {
                label: t("transactionDetailMint"),
                values: [{ value: item.mint }],
              },
            ]
          : []),
        ...(item.error
          ? [
              {
                label: t("transactionDetailError"),
                values: [{ value: item.error }],
              },
            ]
          : []),
        ...(usedTokens.length > 0
          ? [
              {
                label: t("transactionDetailUsedToken"),
                values: usedTokens.map((value) => ({
                  copyValue: value,
                  value: formatCompactToken(value),
                })),
              },
            ]
          : []),
        ...(gainedTokens.length > 0
          ? [
              {
                label: t("transactionDetailGainedToken"),
                values: gainedTokens.map((value) => ({
                  copyValue: value,
                  value: formatCompactToken(value),
                })),
              },
            ]
          : []),
        ...(lnurlSuccessMessage
          ? [
              {
                label: t("transactionDetailLnurlSuccessMessage"),
                values: [{ value: lnurlSuccessMessage }],
              },
            ]
          : []),
        ...(lnurlSuccessUrl
          ? [
              {
                label: t("transactionDetailLnurlSuccessUrl"),
                values: [
                  {
                    value: lnurlSuccessUrlDescription
                      ? `${lnurlSuccessUrlDescription} ${lnurlSuccessUrl}`
                      : lnurlSuccessUrl,
                    copyValue: lnurlSuccessUrl,
                  },
                ],
              },
            ]
          : []),
        ...(lightningMemo
          ? [
              {
                label: t("transactionDetailLightningMemo"),
                values: [{ value: lightningMemo }],
              },
            ]
          : []),
        ...(lightningInvoice
          ? [
              {
                label: t("transactionDetailLightningInvoice"),
                values: [
                  {
                    copyValue: lightningInvoice,
                    value: formatCompactLongString(lightningInvoice),
                  },
                ],
              },
            ]
          : []),
        ...(lightningPreimage
          ? [
              {
                label: t("transactionDetailLightningPreimage"),
                values: [
                  {
                    copyValue: lightningPreimage,
                    value: formatCompactLongString(lightningPreimage),
                  },
                ],
              },
            ]
          : []),
      ];
    },
    [formatAmountText, t, tokenByReferenceId],
  );

  return {
    entries,
    transactionsById,
    pendingOnchainTransfers,
    hasScheduled: recurringOrders.length > 0,
    contactsById,
    nostrPictureByNpub,
    recurringIntervalById,
    buildTitle,
    formatAmountText,
    formatDateText,
    getRequestStatus,
    buildProblemStatusPill,
    buildDetailEntries,
    t,
  };
};
