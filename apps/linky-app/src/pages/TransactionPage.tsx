import {
  Button,
  EmptyState,
  ListRow,
  Section,
  Stack,
  Text,
} from "@linky-fit/ui";
import { readRecurringRunRef } from "@linky-fit/recurring-payment";
import React from "react";
import { useTransactionHistory } from "../app/hooks/payments/useTransactionHistory";
import { useCopyText } from "../app/hooks/shell";
import { readRepeatablePayment } from "../app/lib/transactionHistory";
import { TransactionRow } from "../components/TransactionRow";
import { navigateTo } from "../hooks/useRouting";

/** One transaction of the payment history: its row, then what is known about it. */
export function TransactionPage({ id }: { id: string }): React.ReactElement {
  const history = useTransactionHistory();
  const copyText = useCopyText();
  const { buildDetailEntries, contactsById, t, transactionsById } = history;
  const item = transactionsById.get(id) ?? null;
  const detailEntries = React.useMemo(
    () => (item === null ? [] : buildDetailEntries(item)),
    [buildDetailEntries, item],
  );
  if (item === null) {
    return <EmptyState title={t("onchainTransferNotFound")} />;
  }
  const recurringPaymentId =
    readRecurringRunRef(item.details)?.recurringPaymentId ?? null;
  const repeatable = recurringPaymentId
    ? null
    : readRepeatablePayment(item, contactsById);
  return (
    <Stack gap="$lg" paddingTop="$sm">
      <TransactionRow history={history} item={item} />
      {detailEntries.length > 0 ? (
        <Section>
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
                        {value.value}
                      </Text>
                    );
                  })}
                </Stack>
              }
            />
          ))}
        </Section>
      ) : null}
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
