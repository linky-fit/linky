import {
  Button,
  EmptyState,
  ListRow,
  Pill,
  Section,
  Stack,
  Text,
} from "@linky-fit/ui";
import { readRecurringRunRef } from "@linky-fit/recurring-payment";
import React from "react";
import {
  signedAmountText,
  useTransactionHistory,
} from "../app/hooks/payments/useTransactionHistory";
import { useCopyText, useTranslation } from "../app/hooks/shell";
import { readRepeatablePayment } from "../app/lib/transactionHistory";
import { TransactionAvatar } from "../components/TransactionRow";
import { formatDateTime } from "../utils/formatting";

const withoutScheme = (value: string) => value.replace(/^https?:\/\//u, "");
import { navigateTo } from "../hooks/useRouting";

/** One transaction of the payment history: its row, then what is known about it. */
export function TransactionPage({ id }: { id: string }): React.ReactElement {
  const history = useTransactionHistory();
  const copyText = useCopyText();
  const { lang } = useTranslation();
  const { buildDetailEntries, contactsById, t, transactionsById } = history;
  const item = transactionsById.get(id) ?? null;
  const detailEntries = React.useMemo(
    () => (item === null ? [] : buildDetailEntries(item)),
    [buildDetailEntries, item],
  );
  if (item === null) {
    return <EmptyState title={t("onchainTransferNotFound")} />;
  }
  const problemStatusPill = history.buildProblemStatusPill(
    item,
    history.getRequestStatus(item),
  );
  const recurringPaymentId =
    readRecurringRunRef(item.details)?.recurringPaymentId ?? null;
  const repeatable = recurringPaymentId
    ? null
    : readRepeatablePayment(item, contactsById);
  return (
    <Stack gap="$xl" paddingTop="$sm">
      <Stack alignItems="center" gap="$sm">
        <TransactionAvatar history={history} item={item} size="lg" />
        <Text variant="title" textAlign="center">
          {history.buildTitle(item)}
        </Text>
        <Text
          variant="amount"
          color={item.direction === "in" ? "$accentText" : "$colorStrong"}
          textAlign="center"
          fontVariant={["tabular-nums"]}
        >
          {signedAmountText(history, item)}
        </Text>
        {problemStatusPill ? (
          <Pill label={problemStatusPill.label} tone={problemStatusPill.tone} />
        ) : null}
        {item.note ? (
          <Text color="$colorSubtle" textAlign="center">
            {item.note}
          </Text>
        ) : null}
      </Stack>
      <Section grouped>
        <ListRow
          title={t("transactionWhen")}
          value={formatDateTime(item.createdAtSec * 1000, lang)}
        />
        {detailEntries.map((field, index) => (
          <ListRow
            key={`${field.label}:${index}`}
            title={field.label}
            trailing={
              <Stack gap="$xxs" alignItems="flex-end">
                {field.values.map((value, valueIndex) => {
                  const key = `${field.label}:${index}:${valueIndex}`;
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
                      {withoutScheme(value.value)}
                    </Text>
                  );
                })}
              </Stack>
            }
          />
        ))}
      </Section>
      {recurringPaymentId ? (
        <Button
          variant="secondary"
          icon="Repeat"
          onPress={() =>
            navigateTo({ route: "recurringPayment", id: recurringPaymentId })
          }
        >
          {t("recurringPaymentTitle")}
        </Button>
      ) : null}
      {repeatable ? (
        <Button
          variant="secondary"
          icon="Repeat"
          onPress={() =>
            navigateTo({ route: "recurringPaymentNew", prefill: repeatable })
          }
        >
          {t("recurringRepeatAction")}
        </Button>
      ) : null}
    </Stack>
  );
}
