import { useAtom } from "@linky-fit/linkstr-react";
import {
  Button,
  EmptyState,
  IconButton,
  Row,
  Section,
  Stack,
  Text,
} from "@linky-fit/ui";
import React from "react";
import { useTransactionHistory } from "../app/hooks/payments/useTransactionHistory";
import { useRecurringPaymentOrders } from "../app/hooks/payments/useRecurringPaymentOrders";
import { useTranslation } from "../app/hooks/shell";
import { useOnchainTransfers } from "../app/hooks/useOnchainTransfers";
import { useWalletBalance } from "../app/hooks/wallet/useWalletInventory";
import {
  historyEntryTime,
  type HistoryEntry,
} from "../app/lib/onchainTransferHistory";
import { unfinishedOnchainTransfers } from "../app/lib/onchainTransfers";
import { hiddenTransactionsShownAtom } from "../app/state/shell/topbar";
import { DisplayAmount } from "../components/DisplayAmount";
import { OnchainTransferHistoryRow } from "../components/OnchainTransfer";
import { RecurringPaymentsList } from "../components/RecurringPaymentsList";
import { TransactionRow } from "../components/TransactionRow";
import { WalletPendingReceives } from "../components/WalletPendingReceives";
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

/** A section title above the eyebrow labels of its own groups, e.g. the history's days. */
function SectionHeading({
  title,
  trailing,
}: {
  title: string;
  trailing?: React.ReactNode;
}): React.ReactElement {
  return (
    <Row alignItems="center" minHeight="$controlSm">
      <Text variant="title" bold color="$colorStrong" role="heading" flex={1}>
        {title}
      </Text>
      {trailing}
    </Row>
  );
}

function PendingOnchainTransfers(): React.ReactElement | null {
  const { t } = useTranslation();
  const pending = unfinishedOnchainTransfers(useOnchainTransfers());
  if (pending.length === 0) return null;
  return (
    <Section grouped title={t("onchainTransfersInProgress")}>
      {pending.map((transfer) => (
        <OnchainTransferHistoryRow key={transfer.id} transfer={transfer} />
      ))}
    </Section>
  );
}

function RecurringPayments(): React.ReactElement {
  const { t } = useTranslation();
  const orders = useRecurringPaymentOrders();
  return (
    <Stack gap="$sm">
      <SectionHeading title={t("recurringPaymentsTitle")} />
      <Section grouped>
        {orders.length > 0 ? (
          <RecurringPaymentsList orders={orders} />
        ) : (
          <Text color="$colorSubtle" paddingVertical="$md">
            {t("recurringEmptyHint")}
          </Text>
        )}
      </Section>
      <Button
        variant="accent"
        icon="Plus"
        alignSelf="flex-start"
        onPress={() => navigateTo({ route: "recurringPaymentNew" })}
        data-guide="recurring-add-button"
      >
        {t("recurringPaymentNewTitle")}
      </Button>
    </Stack>
  );
}

function TransactionHistory(): React.ReactElement {
  const history = useTransactionHistory();
  const { entries, t, transactionsById } = history;
  const { lang } = useTranslation();
  const [visibleCount, setVisibleCount] = React.useState(TRANSACTION_PAGE_SIZE);
  const [hiddenShown, setHiddenShown] = useAtom(hiddenTransactionsShownAtom);
  const hasHidden = React.useMemo(
    () =>
      Array.from(transactionsById.values()).some(
        (item) => item.hiddenReason !== null,
      ),
    [transactionsById],
  );
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
    <Stack gap="$sm">
      <SectionHeading
        title={t("transactionsTitle")}
        trailing={
          hasHidden || hiddenShown ? (
            <IconButton
              size="sm"
              icon={hiddenShown ? "Eye" : "EyeOff"}
              accessibilityLabel={t(
                hiddenShown
                  ? "transactionsHideHidden"
                  : "transactionsShowHidden",
              )}
              tooltip={t(
                hiddenShown
                  ? "transactionsHideHidden"
                  : "transactionsShowHidden",
              )}
              onPress={() => setHiddenShown(!hiddenShown)}
            />
          ) : null
        }
      />
      {entries.length === 0 ? (
        <EmptyState icon="History" title={t("paymentsHistoryEmpty")} />
      ) : (
        visibleDays.map((day) => (
          <Section
            key={day.key}
            grouped
            title={formatChatDayLabel(day.atMs, lang, t)}
          >
            {day.entries.map(renderEntry)}
          </Section>
        ))
      )}
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
    </Stack>
  );
}

interface WalletPageProps {
  openScan: () => void;
  scanIsOpen: boolean;
}

export const WalletPage: React.FC<WalletPageProps> = React.memo(
  ({ openScan, scanIsOpen }) => {
    const { t } = useTranslation();
    const { cashuTotalBalance } = useWalletBalance();
    return (
      <Stack gap="$xxl">
        <Stack alignItems="center" gap="$xs" paddingTop="$xxl">
          <DisplayAmount
            amount={cashuTotalBalance}
            accessibilityLabel={t("cashuBalance")}
            size="xl"
          />
          <WalletPendingReceives />
        </Stack>
        <Row gap="$sm">
          <Button
            flex={1}
            icon="ArrowDownRight"
            minHeight="$controlLg"
            borderRadius="$pill"
            onPress={() => navigateTo({ route: "topup" })}
            data-guide="wallet-topup"
          >
            {t("walletReceive")}
          </Button>
          <Button
            flex={1}
            icon="ArrowUpRight"
            minHeight="$controlLg"
            borderRadius="$pill"
            onPress={openScan}
            disabled={scanIsOpen}
            data-guide="wallet-send"
          >
            {t("walletSend")}
          </Button>
        </Row>
        <PendingOnchainTransfers />
        <RecurringPayments />
        <TransactionHistory />
      </Stack>
    );
  },
);
