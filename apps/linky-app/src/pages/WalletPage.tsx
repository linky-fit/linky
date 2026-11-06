import { useAtom } from "@linky-fit/linkstr-react";
import {
  Avatar,
  Button,
  IconButton,
  ListRow,
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
  const addLabel = t("recurringPaymentNewTitle");
  return (
    <Stack gap="$sm">
      <SectionHeading title={t("recurringPaymentsTitle")} />
      <Section grouped>
        <RecurringPaymentsList orders={orders} />
        <ListRow
          leading={<Avatar name={addLabel} icon="Plus" tone="accent" />}
          title={
            <Text bold color="$accentText">
              {addLabel}
            </Text>
          }
          description={
            orders.length === 0 ? t("recurringEmptyHint") : undefined
          }
          accessibilityLabel={addLabel}
          chevron={false}
          onPress={() => navigateTo({ route: "recurringPaymentNew" })}
          testID="recurring-add-button"
        />
      </Section>
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
        <Section grouped>
          <Text color="$colorSubtle" paddingVertical="$md">
            {t("paymentsHistoryEmpty")}
          </Text>
        </Section>
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
          variant="ghost"
          alignSelf="center"
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

/** The recurring payments and the transactions, opened from the wallet's History button. */
export function WalletHistoryPage(): React.ReactElement {
  return (
    <Stack gap="$xxl">
      <RecurringPayments />
      <TransactionHistory />
    </Stack>
  );
}

interface WalletPageProps {
  closeScan: () => void;
  openScan: () => void;
  scanIsOpen: boolean;
}

export const WalletPage: React.FC<WalletPageProps> = React.memo(
  ({ closeScan, openScan, scanIsOpen }) => {
    const { t } = useTranslation();
    const { cashuTotalBalance } = useWalletBalance();
    // On a computer the scanner sits beside the wallet and would hide the page opened from it.
    const openInsteadOfScan = (route: "walletHistory" | "topup") => () => {
      closeScan();
      navigateTo({ route });
    };
    return (
      <Stack flexGrow={1} gap="$xxl" justifyContent="space-between">
        <Stack gap="$xxl">
          <Stack alignItems="center" gap="$xs" paddingTop="$xxl">
            <DisplayAmount
              amount={cashuTotalBalance}
              accessibilityLabel={t("cashuBalance")}
              size="xl"
            />
            <WalletPendingReceives />
            <Button
              variant="ghost"
              size="sm"
              icon="History"
              onPress={openInsteadOfScan("walletHistory")}
            >
              {t("walletHistory")}
            </Button>
          </Stack>
          <PendingOnchainTransfers />
        </Stack>
        <Row gap="$sm">
          <Button
            flex={1}
            icon="ArrowDownRight"
            minHeight="$controlLg"
            borderRadius="$pill"
            onPress={openInsteadOfScan("topup")}
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
      </Stack>
    );
  },
);
