import { Button, Row, Stack } from "@linky-fit/ui";
import type { IconName } from "@linky-fit/ui";
import React from "react";
import { useAppShellActions } from "../app/context/AppShellContexts";
import { DisplayAmount } from "../components/DisplayAmount";
import { WalletPendingReceives } from "../components/WalletPendingReceives";
import { WalletWarning } from "../components/WalletWarning";
import { navigateTo } from "../hooks/useRouting";
import type { Translate } from "../i18n";

interface WalletPageProps {
  cashuTotalBalance: number;
  dismissWalletWarning: () => void;
  openScan: () => void;
  scanIsOpen: boolean;
  showWalletWarning: boolean;
  t: Translate;
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
  ({
    cashuTotalBalance,
    dismissWalletWarning,
    openScan,
    scanIsOpen,
    showWalletWarning,
    t,
  }) => {
    const { openFeedbackContact } = useAppShellActions();
    return (
      <Stack flex={1} gap="$lg">
        <WalletWarning
          dismissed={!showWalletWarning}
          onContactSupport={openFeedbackContact}
          onDismiss={dismissWalletWarning}
          t={t}
        />
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
            />
          </Row>
          <Button
            variant="ghost"
            size="sm"
            onPress={() => navigateTo({ route: "transactions" })}
          >
            {t("showTransactions")}
          </Button>
        </Stack>
      </Stack>
    );
  },
);
