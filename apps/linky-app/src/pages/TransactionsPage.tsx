import {
  type TransactionItem,
  readJsonRecord,
  readStringArrayFromJson,
  readRequestIdFromDetails,
  isPaymentRequestTransaction,
  buildTransactionHistory,
  deriveDeclinedRequestIds,
  readRepeatablePayment,
} from "../app/lib/transactionHistory";
import {
  Avatar,
  Button,
  EmptyState,
  ListRow,
  opacity,
  Row,
  Section,
  Stack,
  Text,
  Pill,
} from "@linky-fit/ui";
import type { Tone } from "@linky-fit/ui";
import React from "react";
import { useAtomValue } from "@linky-fit/linkstr-react";
import { useNostrPictureByNpub } from "../app/hooks/contacts/useProfileCache";
import {
  useCopyText,
  useDisplayAmounts,
  useTranslation,
} from "../app/hooks/shell";
import { hiddenTransactionsShownAtom } from "../app/state/shell/topbar";
import {
  FloatingActionButton,
  floatingActionButtonClearance,
} from "../components/FloatingActionButton";
import { OnchainTransferHistoryRow } from "../components/OnchainTransfer";
import { RecurringPaymentsList } from "../components/RecurringPaymentsList";
import { useRecurringPaymentOrders } from "../app/hooks/payments/useRecurringPaymentOrders";
import { useOnchainTransfers } from "../app/hooks/useOnchainTransfers";
import { withOnchainTransfers } from "../app/lib/onchainTransferHistory";
import { describeRecurringInterval } from "../app/lib/recurringPaymentDisplay";
import { readRecurringRunRef } from "@linky-fit/recurring-payment";
import { navigateTo } from "../hooks/useRouting";

import { createCashuTokenId } from "../app/lib/cashuTokenIdentity";
import { calculateTransactionHistoryFee } from "../app/lib/transactionHistoryFee";
import { deriveDefaultProfile } from "../derivedProfile";
import {
  useContactRows,
  useMessageRows,
  useTransactionRecords,
  useWalletOperations,
} from "../app/hooks/useLinksync";
import type { Translate } from "../i18n";
import { getLightningInvoicePreview } from "@linky-fit/linkshu";
import { formatInteger, formatTimeAgo } from "../utils/formatting";
import { asNonEmptyString } from "../utils/validation";

interface ContactSummary {
  id: string;
  lnAddress: string | null;
  name: string | null;
  npub: string | null;
}

interface TransactionDetailValue {
  copyValue?: string;
  value: string;
}

interface TransactionDetailEntry {
  label: string;
  values: TransactionDetailValue[];
}

interface TransactionStatusPill {
  label: string;
  tone: Tone;
}

const TRANSACTION_PAGE_SIZE = 50;

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

const readLnurlSuccessMessage = (item: TransactionItem): string | null => {
  const details = readJsonRecord(item.details);
  if (!details) return null;
  const message = asNonEmptyString(details.lnurlSuccessMessage);
  if (message) return message;
  const url = asNonEmptyString(details.lnurlSuccessUrl);
  if (!url) return null;
  const description = asNonEmptyString(details.lnurlSuccessUrlDescription);
  return description ? `${description} ${url}` : url;
};

const hasTransactionDetails = (
  item: TransactionItem,
  tokenByReferenceId: ReadonlyMap<string, string>,
): boolean => {
  if (
    item.mint ||
    item.error ||
    (item.direction === "out" && item.fee !== null)
  ) {
    return true;
  }

  const details = readJsonRecord(item.details);
  if (!details) return false;

  const hasStoredToken = (
    rawKeys: readonly string[],
    referenceKey: string,
  ): boolean => {
    if (
      rawKeys.some((key) => asNonEmptyString(details[key]) !== null) ||
      readStringArrayFromJson(details[referenceKey]).some((id) =>
        tokenByReferenceId.has(id),
      )
    ) {
      return true;
    }
    return rawKeys.some(
      (key) => readStringArrayFromJson(details[key]).length > 0,
    );
  };

  return (
    hasStoredToken(["usedInputTokens"], "usedTokenIds") ||
    hasStoredToken(["gainedToken", "acceptedToken"], "gainedTokenIds") ||
    [
      details.lightningInvoice,
      details.lightningPreimage,
      details.lnurlSuccessMessage,
      details.lnurlSuccessUrl,
    ].some((value) => asNonEmptyString(value) !== null)
  );
};

interface TransactionCardProps {
  buildDetailEntries: (item: TransactionItem) => TransactionDetailEntry[];
  buildProblemStatusPill: (
    item: TransactionItem,
    requestStatus: "declined" | "paid" | "pending" | null,
  ) => TransactionStatusPill | null;
  buildTitle: (item: TransactionItem) => string;
  contactsById: ReadonlyMap<string, ContactSummary>;
  copyText: (text: string) => Promise<void>;
  formatAmountText: (amount: number | null, unit: string | null) => string;
  formatDateText: (createdAtSec: number) => string;
  getRequestStatus: (
    item: TransactionItem,
  ) => "declined" | "paid" | "pending" | null;
  isExpanded: boolean;
  item: TransactionItem;
  nostrPictureByNpub: Readonly<Record<string, string | null>>;
  onToggle: (id: string) => void;
  /** Interval label of each live recurring payment, e.g. "monthly"; a deleted one has none. */
  recurringIntervalById: ReadonlyMap<string, string>;
  t: Translate;
  tokenByReferenceId: ReadonlyMap<string, string>;
}

const TransactionCardView = ({
  buildDetailEntries,
  buildProblemStatusPill,
  buildTitle,
  contactsById,
  copyText,
  formatAmountText,
  formatDateText,
  getRequestStatus,
  isExpanded,
  item,
  nostrPictureByNpub,
  onToggle,
  recurringIntervalById,
  t,
  tokenByReferenceId,
}: TransactionCardProps): React.ReactElement => {
  const contact = item.contactId ? contactsById.get(item.contactId) : null;
  const title = buildTitle(item);
  const generatedPicture = contact?.npub
    ? deriveDefaultProfile(contact.npub).pictureUrl
    : null;
  const pictureUrl =
    (contact?.npub ? nostrPictureByNpub[contact.npub] : null) ||
    generatedPicture;
  const amountText = formatAmountText(item.amount, item.unit);
  const requestStatus = getRequestStatus(item);
  const problemStatusPill = buildProblemStatusPill(item, requestStatus);
  const hasDetails = React.useMemo(
    () => hasTransactionDetails(item, tokenByReferenceId),
    [item, tokenByReferenceId],
  );
  const detailEntries = React.useMemo(
    () => (hasDetails && isExpanded ? buildDetailEntries(item) : []),
    [buildDetailEntries, hasDetails, isExpanded, item],
  );
  const isUnsuccessful =
    requestStatus === "declined" ||
    item.status === "declined" ||
    item.status === "error" ||
    item.hiddenReason !== null ||
    item.isReturned;
  const lnurlMessage = readLnurlSuccessMessage(item);
  const recurringPaymentId =
    readRecurringRunRef(item.details)?.recurringPaymentId ?? null;
  const repeatable = recurringPaymentId
    ? null
    : readRepeatablePayment(item, contactsById);

  return (
    <Stack
      testID="transaction-card"
      gap="$none"
      opacity={isUnsuccessful ? opacity.disabled : 1}
    >
      <ListRow
        leading={
          <Avatar
            name={contact?.name || title}
            uri={contact ? (pictureUrl ?? undefined) : undefined}
            icon={
              contact
                ? undefined
                : item.category === "lightning"
                  ? "Zap"
                  : "Bean"
            }
          />
        }
        title={title}
        description={
          <Stack gap="$xxs">
            {item.note && item.note !== title ? (
              <Text variant="caption" color="$colorSubtle" numberOfLines={2}>
                {item.note}
              </Text>
            ) : null}
            {lnurlMessage ? (
              <Text variant="caption" color="$colorSubtle" numberOfLines={2}>
                {lnurlMessage}
              </Text>
            ) : null}
            <Row gap="$sm" flexWrap="wrap">
              <Text variant="caption" color="$colorMuted">
                {formatDateText(item.createdAtSec)}
              </Text>
              {recurringPaymentId ? (
                <Pill
                  size="sm"
                  tone="neutral"
                  label={
                    recurringIntervalById.get(recurringPaymentId) ??
                    t("recurringPaymentTitle")
                  }
                  testID="transaction-recurring-pill"
                />
              ) : null}
              {problemStatusPill ? (
                <Pill
                  size="sm"
                  label={problemStatusPill.label}
                  tone={problemStatusPill.tone}
                />
              ) : null}
            </Row>
          </Stack>
        }
        trailing={
          <Text
            variant="label"
            bold
            color={item.direction === "in" ? "$accentText" : "$dangerText"}
          >
            {amountText}
          </Text>
        }
        chevron={false}
        expanded={hasDetails ? isExpanded : undefined}
        onPress={hasDetails ? () => onToggle(item.id) : undefined}
      />
      {detailEntries.map((field, index) => (
        <ListRow
          key={`${item.id}:${field.label}:${index}`}
          title={field.label}
          trailing={
            <Stack gap="$xxs" alignItems="flex-end">
              {field.values.map((value, valueIndex) => {
                const key = `${item.id}:${field.label}:${index}:${valueIndex}`;
                const { copyValue } = value;
                return copyValue ? (
                  <Button
                    key={key}
                    variant="ghost"
                    size="sm"
                    icon="Copy"
                    tooltip={t("copy")}
                    onPress={() => void copyText(copyValue)}
                  >
                    {value.value}
                  </Button>
                ) : (
                  <Text key={key} variant="label" color="$colorMuted">
                    {value.value}
                  </Text>
                );
              })}
            </Stack>
          }
        />
      ))}
      {isExpanded && recurringPaymentId ? (
        <Button
          variant="secondary"
          size="sm"
          icon="Repeat"
          alignSelf="flex-start"
          onPress={() =>
            navigateTo({ route: "recurringPayment", id: recurringPaymentId })
          }
        >
          {t("recurringPaymentTitle")}
        </Button>
      ) : null}
      {isExpanded && repeatable ? (
        <Button
          variant="secondary"
          size="sm"
          icon="Repeat"
          alignSelf="flex-start"
          onPress={() =>
            navigateTo({ route: "recurringPaymentNew", prefill: repeatable })
          }
        >
          {t("recurringRepeatAction")}
        </Button>
      ) : null}
    </Stack>
  );
};

const TransactionCard = React.memo(TransactionCardView);

export function TransactionsPage(): React.ReactElement {
  const { lang, t } = useTranslation();
  const { formatDisplayedAmountText } = useDisplayAmounts();
  const nostrPictureByNpub = useNostrPictureByNpub();
  const showHiddenTransactions = useAtomValue(hiddenTransactionsShownAtom);
  const copyText = useCopyText();
  const [expandedById, setExpandedById] = React.useState<
    Record<string, boolean>
  >({});
  const [visibleCount, setVisibleCount] = React.useState(TRANSACTION_PAGE_SIZE);

  const contactRows = useContactRows();
  const cashuOperations = useWalletOperations();
  const messageRows = useMessageRows();
  const transactionRecords = useTransactionRecords();
  const recurringOrders = useRecurringPaymentOrders();
  const hasScheduled = recurringOrders.length > 0;
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
  const visibleEntries = React.useMemo(
    () => entries.slice(0, visibleCount),
    [entries, visibleCount],
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
      requestStatus: "declined" | "paid" | "pending" | null,
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
    (item: TransactionItem): "declined" | "paid" | "pending" | null => {
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

  const toggleExpanded = React.useCallback((id: string) => {
    setExpandedById((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  }, []);

  return (
    <Stack paddingTop="$sm" paddingBottom={floatingActionButtonClearance}>
      {hasScheduled ? (
        <Section title={t("recurringScheduledSection")}>
          <RecurringPaymentsList />
        </Section>
      ) : null}
      {pendingOnchainTransfers.length > 0 ? (
        <Section title={t("onchainTransfersInProgress")}>
          <Stack gap="$xs">
            {pendingOnchainTransfers.map((transfer) => (
              <OnchainTransferHistoryRow
                key={transfer.id}
                transfer={transfer}
              />
            ))}
          </Stack>
        </Section>
      ) : null}
      <Section
        title={
          hasScheduled || pendingOnchainTransfers.length > 0
            ? t("recurringHistorySection")
            : undefined
        }
      >
        {entries.length === 0 ? (
          <EmptyState title={t("paymentsHistoryEmpty")} />
        ) : (
          <>
            <Stack gap="$xs">
              {visibleEntries.map((entry) =>
                entry.kind === "onchainTransfer" ? (
                  <OnchainTransferHistoryRow
                    key={entry.transfer.id}
                    transfer={entry.transfer}
                  />
                ) : (
                  <TransactionCard
                    buildDetailEntries={buildDetailEntries}
                    buildProblemStatusPill={buildProblemStatusPill}
                    buildTitle={buildTitle}
                    contactsById={contactsById}
                    copyText={copyText}
                    formatAmountText={formatAmountText}
                    formatDateText={formatDateText}
                    getRequestStatus={getRequestStatus}
                    isExpanded={expandedById[entry.item.id] === true}
                    item={entry.item}
                    key={entry.item.id}
                    nostrPictureByNpub={nostrPictureByNpub}
                    onToggle={toggleExpanded}
                    recurringIntervalById={recurringIntervalById}
                    t={t}
                    tokenByReferenceId={tokenByReferenceId}
                  />
                ),
              )}
            </Stack>
            {visibleCount < entries.length ? (
              <Button
                variant="secondary"
                onPress={() =>
                  setVisibleCount((count) => count + TRANSACTION_PAGE_SIZE)
                }
              >
                {t("loadMore")}
              </Button>
            ) : null}
          </>
        )}
      </Section>
      <FloatingActionButton
        icon="Repeat"
        label={t("recurringSave")}
        onPress={() => navigateTo({ route: "recurringPaymentNew" })}
        guide="recurring-add-button"
      />
    </Stack>
  );
}
