import {
  Avatar,
  ListRow,
  opacity,
  Pill,
  Row,
  Stack,
  Text,
} from "@linky-fit/ui";
import { readRecurringRunRef } from "@linky-fit/recurring-payment";
import React from "react";
import {
  readLnurlSuccessMessage,
  type TransactionHistory,
} from "../app/hooks/payments/useTransactionHistory";
import type { TransactionItem } from "../app/lib/transactionHistory";
import { deriveDefaultProfile } from "../derivedProfile";

interface TransactionRowProps {
  history: TransactionHistory;
  item: TransactionItem;
  /** Opens the transaction; a detail page heading itself passes none. */
  onPress?: (() => void) | undefined;
}

/** Whether the transaction did not go, or does not count, so its row fades. */
const isUnsuccessfulTransaction = (
  item: TransactionItem,
  requestStatus: ReturnType<TransactionHistory["getRequestStatus"]>,
): boolean =>
  requestStatus === "declined" ||
  item.status === "declined" ||
  item.status === "error" ||
  item.hiddenReason !== null ||
  item.isReturned;

/** A transaction in the payment history: who or what, when, its state and its amount. */
export function TransactionRow({
  history,
  item,
  onPress,
}: TransactionRowProps): React.ReactElement {
  const {
    buildProblemStatusPill,
    buildTitle,
    contactsById,
    formatAmountText,
    formatDateText,
    getRequestStatus,
    nostrPictureByNpub,
    recurringIntervalById,
    t,
  } = history;
  const contact = item.contactId ? contactsById.get(item.contactId) : null;
  const title = buildTitle(item);
  const generatedPicture = contact?.npub
    ? deriveDefaultProfile(contact.npub).pictureUrl
    : null;
  const pictureUrl =
    (contact?.npub ? nostrPictureByNpub[contact.npub] : null) ||
    generatedPicture;
  const requestStatus = getRequestStatus(item);
  const problemStatusPill = buildProblemStatusPill(item, requestStatus);
  const lnurlMessage = readLnurlSuccessMessage(item);
  const recurringPaymentId =
    readRecurringRunRef(item.details)?.recurringPaymentId ?? null;

  return (
    <Stack
      testID="transaction-card"
      opacity={
        isUnsuccessfulTransaction(item, requestStatus) ? opacity.disabled : 1
      }
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
            {formatAmountText(item.amount, item.unit)}
          </Text>
        }
        chevron={false}
        onPress={onPress}
      />
    </Stack>
  );
}
