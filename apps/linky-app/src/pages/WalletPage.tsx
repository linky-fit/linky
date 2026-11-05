import { Button, Row, Section, Stack, StatusDot, Text } from "@linky-fit/ui";
import React from "react";
import { useTransactionHistory } from "../app/hooks/payments/useTransactionHistory";
import { useTranslation } from "../app/hooks/shell";
import { usePendingOnchainTransfersLink } from "../app/hooks/useOnchainTransfers";
import { useWalletBalance } from "../app/hooks/wallet/useWalletInventory";
import { DisplayAmount } from "../components/DisplayAmount";
import { OnchainTransferHistoryRow } from "../components/OnchainTransfer";
import { TransactionRow } from "../components/TransactionRow";
import { WalletPendingReceives } from "../components/WalletPendingReceives";
import { navigateTo } from "../hooks/useRouting";

const RECENT_TRANSACTIONS = 4;

interface WalletPageProps {
  /** Docks Receive and Send at the bottom of a pane taller than the wallet, as in the desktop column. */
  actionsAtBottom: boolean;
  openScan: () => void;
  scanIsOpen: boolean;
  showRecent: boolean;
}

function RecentTransactions(): React.ReactElement {
  const history = useTransactionHistory();
  const pendingOnchainTransfers = usePendingOnchainTransfersLink();
  const { t } = history;
  const recent = history.entries.slice(0, RECENT_TRANSACTIONS);
  return (
    <Stack gap="$xs">
      <Text eyebrow role="heading" paddingHorizontal="$md">
        {t("walletRecent")}
      </Text>
      {recent.length === 0 ? null : (
        <Section grouped>
          {recent.map((entry) =>
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
        </Section>
      )}
      <Button
        variant="ghost"
        size="sm"
        alignSelf="center"
        onPress={() => navigateTo({ route: "transactions" })}
      >
        <Row alignItems="center" gap="$sm">
          <Text variant="caption" bold color="$accentText" numberOfLines={1}>
            {t("walletSeeAll")}
          </Text>
          {pendingOnchainTransfers ? (
            <StatusDot
              tone="accent"
              accessibilityLabel={pendingOnchainTransfers.label}
              testID="wallet-pending-onchain"
            />
          ) : null}
        </Row>
      </Button>
    </Stack>
  );
}

export const WalletPage: React.FC<WalletPageProps> = React.memo(
  ({ actionsAtBottom, openScan, scanIsOpen, showRecent }) => {
    const { t } = useTranslation();
    const { cashuTotalBalance } = useWalletBalance();
    const actions = (
      <Row gap="$sm" width="100%" maxWidth="$form" alignSelf="center">
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
    );
    return (
      <Stack gap="$xxxl" flexGrow={1}>
        <Stack alignItems="center" gap="$xs" paddingTop="$xxl">
          <DisplayAmount
            amount={cashuTotalBalance}
            accessibilityLabel={t("cashuBalance")}
            size="xl"
          />
          <WalletPendingReceives />
        </Stack>
        {actionsAtBottom ? null : actions}
        {showRecent ? <RecentTransactions /> : null}
        {actionsAtBottom ? (
          <Stack flexGrow={1} justifyContent="flex-end">
            {actions}
          </Stack>
        ) : null}
      </Stack>
    );
  },
);
