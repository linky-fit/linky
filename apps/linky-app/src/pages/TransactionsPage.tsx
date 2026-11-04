import { Button, EmptyState, Section, Stack } from "@linky-fit/ui";
import React from "react";
import { useTransactionHistory } from "../app/hooks/payments/useTransactionHistory";
import {
  historyEntryTime,
  type HistoryEntry,
} from "../app/lib/onchainTransferHistory";
import { useTranslation } from "../app/hooks/shell";
import {
  FloatingActionButton,
  floatingActionButtonClearance,
} from "../components/FloatingActionButton";
import { OnchainTransferHistoryRow } from "../components/OnchainTransfer";
import { RecurringPaymentsList } from "../components/RecurringPaymentsList";
import { TransactionRow } from "../components/TransactionRow";
import { navigateTo } from "../hooks/useRouting";
import { formatChatDayLabel } from "../utils/formatting";

const TRANSACTION_PAGE_SIZE = 50;

/** Runs of entries from the same calendar day, newest first like the entries. */
const groupByDay = (entries: readonly HistoryEntry[]) => {
  const days: { key: string; atMs: number; entries: HistoryEntry[] }[] = [];
  for (const entry of entries) {
    const atMs = historyEntryTime(entry) * 1000;
    const key = new Date(atMs).toDateString();
    const last = days.at(-1);
    if (last?.key === key) last.entries.push(entry);
    else days.push({ key, atMs, entries: [entry] });
  }
  return days;
};

export function TransactionsPage(): React.ReactElement {
  const history = useTransactionHistory();
  const { entries, hasScheduled, pendingOnchainTransfers, t } = history;
  const [visibleCount, setVisibleCount] = React.useState(TRANSACTION_PAGE_SIZE);
  const { lang } = useTranslation();
  const visibleDays = React.useMemo(
    () => groupByDay(entries.slice(0, visibleCount)),
    [entries, visibleCount],
  );
  const renderEntry = (entry: HistoryEntry) =>
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
        onPress={() => navigateTo({ route: "transaction", id: entry.item.id })}
      />
    );

  return (
    <Stack paddingTop="$sm" paddingBottom={floatingActionButtonClearance}>
      <FloatingActionButton
        icon="Repeat"
        label={t("recurringSave")}
        onPress={() => navigateTo({ route: "recurringPaymentNew" })}
        guide="recurring-add-button"
      />
      {hasScheduled ? (
        <Section grouped title={t("recurringScheduledSection")}>
          <RecurringPaymentsList />
        </Section>
      ) : null}
      {pendingOnchainTransfers.length > 0 ? (
        <Section grouped title={t("onchainTransfersInProgress")}>
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
      {entries.length === 0 ? (
        <EmptyState icon="History" title={t("paymentsHistoryEmpty")} />
      ) : (
        <>
          {visibleDays.map((day) => (
            <Section
              key={day.key}
              grouped
              title={formatChatDayLabel(day.atMs, lang, t)}
            >
              {day.entries.map(renderEntry)}
            </Section>
          ))}
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
    </Stack>
  );
}
