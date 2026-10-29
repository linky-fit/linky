import { Button, EmptyState, Section, Stack } from "@linky-fit/ui";
import React from "react";
import { useTransactionHistory } from "../app/hooks/payments/useTransactionHistory";
import {
  FloatingActionButton,
  floatingActionButtonClearance,
} from "../components/FloatingActionButton";
import { OnchainTransferHistoryRow } from "../components/OnchainTransfer";
import { RecurringPaymentsList } from "../components/RecurringPaymentsList";
import { TransactionRow } from "../components/TransactionRow";
import { navigateTo } from "../hooks/useRouting";

const TRANSACTION_PAGE_SIZE = 50;

export function TransactionsPage(): React.ReactElement {
  const history = useTransactionHistory();
  const { entries, hasScheduled, pendingOnchainTransfers, t } = history;
  const [visibleCount, setVisibleCount] = React.useState(TRANSACTION_PAGE_SIZE);
  const visibleEntries = React.useMemo(
    () => entries.slice(0, visibleCount),
    [entries, visibleCount],
  );

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
                  <TransactionRow
                    key={entry.item.id}
                    history={history}
                    item={entry.item}
                    onPress={() =>
                      navigateTo({ route: "transaction", id: entry.item.id })
                    }
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
