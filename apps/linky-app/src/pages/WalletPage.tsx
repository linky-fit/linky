import {
  Button,
  Row,
  Section,
  space,
  Stack,
  StatusDot,
  Text,
} from "@linky-fit/ui";
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
  openScan: () => void;
  scanIsOpen: boolean;
}

function RecentTransactions(): React.ReactElement {
  const history = useTransactionHistory();
  const pendingOnchainTransfers = usePendingOnchainTransfersLink();
  const { t } = history;
  const recent = history.entries.slice(0, RECENT_TRANSACTIONS);
  return (
    <Stack gap="$xs">
      <Row justifyContent="space-between" paddingHorizontal="$md">
        <Text eyebrow role="heading">
          {t("walletRecent")}
        </Text>
        <Button
          variant="ghost"
          size="sm"
          // Outset by its padding so the label lines up with the amounts below.
          marginRight={-space.md}
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
      </Row>
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
    </Stack>
  );
}

export const WalletPage: React.FC<WalletPageProps> = React.memo(
  ({ openScan, scanIsOpen }) => {
    const { t } = useTranslation();
    const { cashuTotalBalance } = useWalletBalance();
    return (
      <Stack gap="$xxxl">
        <Stack alignItems="center" gap="$xs" paddingTop="$xxl">
          <DisplayAmount
            amount={cashuTotalBalance}
            accessibilityLabel={t("cashuBalance")}
            size="xl"
          />
          <WalletPendingReceives />
        </Stack>
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
        <RecentTransactions />
      </Stack>
    );
  },
);
