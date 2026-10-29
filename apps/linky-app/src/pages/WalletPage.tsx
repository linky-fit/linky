import { Button, Row, Stack, StatusDot, Text } from "@linky-fit/ui";
import type { IconName } from "@linky-fit/ui";
import React from "react";
import { useTranslation } from "../app/hooks/shell";
import { usePendingOnchainTransfersLink } from "../app/hooks/useOnchainTransfers";
import { useWalletBalance } from "../app/hooks/wallet/useWalletInventory";
import { DisplayAmount } from "../components/DisplayAmount";
import { WalletPendingReceives } from "../components/WalletPendingReceives";
import { navigateTo } from "../hooks/useRouting";

interface WalletPageProps {
  openScan: () => void;
  scanIsOpen: boolean;
}

interface WalletActionProps {
  dataGuide?: string;
  disabled?: boolean;
  icon: IconName;
  label: string;
  onPress: () => void;
}

const WalletAction = ({
  dataGuide,
  disabled = false,
  icon,
  label,
  onPress,
}: WalletActionProps) => (
  <Button
    variant="secondary"
    icon={icon}
    flexDirection="column"
    width="$column"
    flexShrink={1}
    paddingVertical="$xl"
    disabled={disabled}
    onPress={onPress}
    data-guide={dataGuide}
  >
    {label}
  </Button>
);

export const WalletPage: React.FC<WalletPageProps> = React.memo(
  ({ openScan, scanIsOpen }) => {
    const { t } = useTranslation();
    const { cashuTotalBalance } = useWalletBalance();
    const pendingOnchainTransfers = usePendingOnchainTransfersLink();
    return (
      <Stack flex={1} gap="$lg">
        <Stack
          flex={1}
          justifyContent="center"
          alignItems="center"
          gap="$xxl"
          paddingBottom="$huge"
        >
          <Stack alignItems="center" gap="$xs">
            <DisplayAmount
              amount={cashuTotalBalance}
              accessibilityLabel={t("cashuBalance")}
              size="lg"
            />
            <WalletPendingReceives />
          </Stack>
          <Row marginTop="$xxl" maxWidth="100%">
            <WalletAction
              icon="ArrowDownRight"
              label={t("walletReceive")}
              onPress={() => navigateTo({ route: "topup" })}
              dataGuide="wallet-topup"
            />
            <WalletAction
              icon="ArrowUpRight"
              label={t("walletSend")}
              onPress={openScan}
              disabled={scanIsOpen}
              dataGuide="wallet-send"
            />
          </Row>
          <Button
            variant="ghost"
            size="sm"
            onPress={() => navigateTo({ route: "transactions" })}
          >
            <Row alignItems="center" gap="$sm">
              <Text variant="caption" bold textAlign="center" numberOfLines={1}>
                {t("showTransactions")}
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
      </Stack>
    );
  },
);
