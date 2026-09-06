import React from "react";
import { useAppShellActions } from "../app/context/AppShellContexts";
import { BottomTabBar } from "../components/BottomTabBar";
import { WalletActionButton } from "../components/WalletActionButton";
import { WalletBalance } from "../components/WalletBalance";
import { WalletWarning } from "../components/WalletWarning";
import { navigateTo } from "../hooks/useRouting";
import type { Translate } from "../i18n";

interface WalletPageProps {
  bottomTabActive: "wallet" | "contacts" | null;
  cashuTotalBalance: number;
  dismissWalletWarning: () => void;
  openScan: () => void;
  scanIsOpen: boolean;
  showWalletWarning: boolean;
  showBottomTabBar?: boolean;
  t: Translate;
}

export const WalletPage: React.FC<WalletPageProps> = React.memo(
  ({
    bottomTabActive,
    cashuTotalBalance,
    dismissWalletWarning,
    openScan,
    scanIsOpen,
    showWalletWarning,
    showBottomTabBar = true,
    t,
  }) => {
    const { openFeedbackContact } = useAppShellActions();
    return (
      <section className="panel panel-plain wallet-panel">
        <WalletWarning
          dismissed={!showWalletWarning}
          onContactSupport={openFeedbackContact}
          onDismiss={dismissWalletWarning}
          t={t}
        />
        <div className="panel-header">
          <div className="wallet-hero">
            <WalletBalance
              balance={cashuTotalBalance}
              ariaLabel={t("cashuBalance")}
            />
            <div className="wallet-actions">
              <WalletActionButton
                icon="topup"
                label={t("walletReceive")}
                onClick={() => navigateTo({ route: "topup" })}
                dataGuide="wallet-topup"
              />
              <WalletActionButton
                icon="send"
                label={t("walletSend")}
                onClick={openScan}
                disabled={scanIsOpen}
              />
            </div>
            <button
              type="button"
              className="wallet-subtle-link"
              onClick={() => navigateTo({ route: "transactions" })}
            >
              {t("showTransactions")}
            </button>
          </div>
        </div>
        {showBottomTabBar ? (
          <BottomTabBar
            activeTab={bottomTabActive}
            contactsLabel={t("contactsTitle")}
            t={t}
            walletLabel={t("wallet")}
          />
        ) : null}
      </section>
    );
  },
);
