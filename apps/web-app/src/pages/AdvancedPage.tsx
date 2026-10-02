import {
  Bean,
  Bell,
  Bitcoin,
  BrushCleaning,
  Bug,
  CheckCheck,
  Cloud,
  Coins,
  Copy,
  Download,
  FlaskConical,
  MessageCircle as FeedbackIcon,
  HandCoins,
  Smartphone,
  Landmark,
  Languages,
  LogOut,
  QrCode,
  RadioTower,
  RotateCw,
  ShieldCheck,
  Upload,
  UserRound,
  Zap,
} from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  useAppShellActions,
  useAppShellCore,
} from "../app/context/AppShellContexts";
import {
  useAdvancedSettingsContext,
  useMintSettingsContext,
} from "../app/context/SystemSettingsContexts";
import {
  countConnectedRelays,
  overallRelayStatus,
  useRelayHealth,
} from "../app/hooks/useRelayHealth";
import { usePushNotificationsSetting } from "../app/hooks/usePushNotificationsSetting";

import { SettingsLinkRow, SettingsToggleRow } from "../components/SettingsRows";
import { navigateTo } from "../hooks/useRouting";
import type { I18nKey } from "../i18n";
import { RECEIVE_METHOD_LABEL_KEYS } from "../utils/receiveMethod";

export function AdvancedPage(): React.ReactElement {
  const {
    copyNostrKeys,
    dedupeContacts,
    dedupeContactsIsBusy,
    defaultMintDisplay,
    evoluConnectedServerCount,
    evoluOverallStatus,
    evoluServerUrls,
    exportAppData,
    handleImportAppDataFilePicked,
    importDataFileInputRef,
    lightningInvoiceAutoPayLimit,
    logoutArmed,
    payWithCashuEnabled,
    pushToast,
    receiveMethod,
    relayUrls,
    requestImportAppData,
    requestLogout,
    requestPasteNostrKeys,
    seedMnemonic,
    setPayWithCashuEnabled,
  } = useAdvancedSettingsContext();
  const { allowTestMints, setAllowTestMints } = useMintSettingsContext();
  const relayHealth = useRelayHealth();
  const connectedRelayCount = countConnectedRelays(relayUrls, relayHealth);
  const nostrRelayOverallStatus = overallRelayStatus(relayUrls, relayHealth);

  const {
    currentNsec,
    formatDisplayedAmountParts,
    sendReadReceiptsEnabled,
    showProfileQrOnTiltEnabled,
    t,
  } = useAppShellCore();
  const {
    openFeedbackContact,
    toggleSendReadReceipts,
    toggleShowProfileQrOnTilt,
  } = useAppShellActions();
  const notifications = usePushNotificationsSetting();
  const [armedSecurityAction, setArmedSecurityAction] = useState<
    "copyNostr" | "pasteNostr" | null
  >(null);
  const armTimeoutRef = useRef<number | null>(null);
  const hasSeedMnemonic = (seedMnemonic ?? "").trim().length > 0;
  const hasCurrentNsec = (currentNsec ?? "").trim().length > 0;
  const appVersionLabel = __APP_COMMIT_SHA__
    ? `${__APP_VERSION__} (${__APP_COMMIT_SHA__})`
    : `${__APP_VERSION__}`;

  const getAutoPayLimitLabel = useCallback(
    (limit: number) => {
      const displayAmount = formatDisplayedAmountParts(limit);
      return `${displayAmount.approxPrefix}${displayAmount.amountText} ${displayAmount.unitLabel}`;
    },
    [formatDisplayedAmountParts],
  );

  const clearArmTimeout = useCallback(() => {
    if (armTimeoutRef.current !== null) {
      window.clearTimeout(armTimeoutRef.current);
      armTimeoutRef.current = null;
    }
  }, []);

  const handleReloadApp = useCallback(async () => {
    if ("serviceWorker" in navigator) {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.allSettled(
          registrations.map((registration) => registration.update()),
        );
      } catch {
        // Reload anyway even if the service worker update check fails.
      }
    }

    window.location.reload();
  }, []);

  const requestSecurityAction = useCallback(
    (
      action: "copyNostr" | "pasteNostr",
      run: () => void | Promise<void>,
      hintKey: I18nKey = "sensitiveActionArmedHint",
    ) => {
      if (armedSecurityAction === action) {
        clearArmTimeout();
        setArmedSecurityAction(null);
        void run();
        return;
      }

      clearArmTimeout();
      setArmedSecurityAction(action);
      pushToast(t(hintKey));
      armTimeoutRef.current = window.setTimeout(() => {
        setArmedSecurityAction(null);
        armTimeoutRef.current = null;
      }, 5000);
    },
    [armedSecurityAction, clearArmTimeout, pushToast, t],
  );

  useEffect(() => {
    return () => {
      clearArmTimeout();
    };
  }, [clearArmTimeout]);

  return (
    <section className="panel settings-page">
      <div className="settings-section">
        <h2 className="settings-section-title">{t("settingsGeneral")}</h2>

        <SettingsLinkRow
          onClick={() => navigateTo({ route: "settingsLanguage" })}
          icon={<Languages size={18} />}
          label={t("language")}
        />

        <SettingsLinkRow
          onClick={() => navigateTo({ route: "settingsUnits" })}
          icon={<Bitcoin size={18} />}
          label={t("unit")}
        />

        <SettingsLinkRow
          onClick={openFeedbackContact}
          icon={<FeedbackIcon size={18} />}
          label={t("feedback")}
        />

        <SettingsToggleRow
          icon={<Bell size={18} />}
          label={t("notifications")}
          checked={notifications.enabled}
          disabled={!currentNsec || notifications.isBusy}
          onChange={(checked) => void notifications.setEnabled(checked)}
        />

        <SettingsToggleRow
          icon={<CheckCheck size={18} />}
          label={t("sendReadReceipts")}
          checked={sendReadReceiptsEnabled}
          onChange={toggleSendReadReceipts}
        />

        <SettingsToggleRow
          icon={<Smartphone size={18} />}
          label={t("showProfileQrOnTilt")}
          checked={showProfileQrOnTiltEnabled}
          onChange={toggleShowProfileQrOnTilt}
        />
      </div>

      <div className="settings-section">
        <h2 className="settings-section-title">{t("settingsPayments")}</h2>

        <SettingsLinkRow
          onClick={() => navigateTo({ route: "settingsProxyPayments" })}
          icon={<HandCoins size={18} />}
          label={t("proxyPayments")}
        />

        <SettingsLinkRow
          onClick={() => navigateTo({ route: "settingsReceiveMethod" })}
          icon={<QrCode size={18} />}
          label={t("receiveMethod")}
          tail={
            <span className="settings-tail-content settings-value">
              {t(RECEIVE_METHOD_LABEL_KEYS[receiveMethod])}
            </span>
          }
        />

        <SettingsToggleRow
          icon={<Bean size={18} />}
          label={t("preferCashu")}
          checked={payWithCashuEnabled}
          onChange={setPayWithCashuEnabled}
        />

        <SettingsLinkRow
          onClick={() => navigateTo({ route: "advancedAutoPayLimit" })}
          icon={<Zap size={18} />}
          label={t("lightningInvoiceAutoPayLimit")}
          tail={
            <span className="settings-tail-content settings-value">
              {getAutoPayLimitLabel(lightningInvoiceAutoPayLimit)}
            </span>
          }
        />
      </div>

      <div className="settings-section">
        <h2 className="settings-section-title">{t("settingsNetwork")}</h2>

        <SettingsLinkRow
          onClick={() => navigateTo({ route: "nostrRelays" })}
          icon={<RadioTower size={18} />}
          label="Nostr"
          tail={
            <span className="settings-tail-content settings-connection-state">
              <span className="relay-count">
                {connectedRelayCount}/{relayUrls.length}
              </span>
              <span className={`status-dot ${nostrRelayOverallStatus}`} />
            </span>
          }
        />

        <SettingsLinkRow
          onClick={() => navigateTo({ route: "evoluServers" })}
          icon={<Cloud size={18} />}
          label="Evolu"
          tail={
            <span className="settings-tail-content settings-connection-state">
              <span className="relay-count">
                {evoluConnectedServerCount}/{evoluServerUrls.length}
              </span>
              <span className={`status-dot ${evoluOverallStatus}`} />
            </span>
          }
        />

        <SettingsLinkRow
          onClick={() => navigateTo({ route: "mints" })}
          icon={<Landmark size={18} />}
          label="Mint"
          tail={
            defaultMintDisplay ? (
              <span className="settings-tail-content settings-value settings-value-truncate">
                {defaultMintDisplay}
              </span>
            ) : null
          }
        />

        <SettingsToggleRow
          icon={<FlaskConical size={18} />}
          label={t("allowTestMints")}
          checked={allowTestMints}
          onChange={(checked) =>
            void setAllowTestMints(checked).then((outcome) => {
              if (!outcome.ok) pushToast(outcome.error);
            })
          }
        />
      </div>

      <div className="settings-section">
        <h2 className="settings-section-title">{t("settingsDebug")}</h2>

        <SettingsLinkRow
          onClick={() => navigateTo({ route: "cashuTokens" })}
          icon={<Coins size={18} />}
          label={t("tokens")}
        />

        <SettingsLinkRow
          onClick={exportAppData}
          icon={<Upload size={18} />}
          label={t("exportData")}
        />

        <SettingsLinkRow
          onClick={requestImportAppData}
          icon={<Download size={18} />}
          label={t("importData")}
        />

        <SettingsLinkRow
          onClick={() => void dedupeContacts()}
          disabled={dedupeContactsIsBusy}
          icon={<BrushCleaning size={18} />}
          label={t("dedupeContacts")}
        />

        <input
          ref={importDataFileInputRef}
          type="file"
          accept=".txt,.json,application/json,text/plain"
          className="hidden-input"
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            e.currentTarget.value = "";
            void handleImportAppDataFilePicked(file);
          }}
        />

        <SettingsLinkRow
          onClick={() => void handleReloadApp()}
          icon={<RotateCw size={18} />}
          label={t("reloadApp")}
        />

        <SettingsLinkRow
          onClick={() => navigateTo({ route: "advancedInspector" })}
          icon={<Bug size={18} />}
          label={t("nostrInspector")}
        />
      </div>

      <div className="settings-section">
        <h2 className="settings-section-title">{t("settingsSecurity")}</h2>

        <SettingsLinkRow
          onClick={() => navigateTo({ route: "settingsMasterKeys" })}
          disabled={!hasSeedMnemonic}
          dataGuide="open-master-keys"
          icon={<ShieldCheck size={18} />}
          label={t("masterKeys")}
        />

        <SettingsLinkRow
          className={
            armedSecurityAction === "copyNostr"
              ? "settings-sensitive-action is-armed"
              : "settings-sensitive-action"
          }
          onClick={() => requestSecurityAction("copyNostr", copyNostrKeys)}
          disabled={!hasCurrentNsec}
          dataGuide="copy-nostr-keys"
          icon={<Copy size={18} />}
          label={t("copyNostrKeys")}
        />

        <SettingsLinkRow
          className={
            armedSecurityAction === "pasteNostr"
              ? "settings-sensitive-action is-armed"
              : "settings-sensitive-action"
          }
          onClick={() =>
            requestSecurityAction(
              "pasteNostr",
              requestPasteNostrKeys,
              "nostrPasteArmedHint",
            )
          }
          disabled={!hasCurrentNsec || !hasSeedMnemonic}
          icon={<UserRound size={18} />}
          label={t("pasteCustomNostrKeys")}
        />

        <SettingsLinkRow
          className={
            logoutArmed
              ? "settings-danger-link is-armed"
              : "settings-danger-link"
          }
          onClick={() =>
            requestLogout({
              evoluConnected: evoluOverallStatus === "connected",
            })
          }
          icon={<LogOut size={18} />}
          label={t("logout")}
        />
      </div>

      <div className="settings-version">
        <div className="muted">{appVersionLabel}</div>
      </div>
    </section>
  );
}
