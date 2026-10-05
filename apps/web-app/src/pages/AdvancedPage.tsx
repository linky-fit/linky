import {
  Divider,
  ListRow,
  Row,
  Section,
  Spinner,
  Stack,
  StatusDot,
  Switch,
  Text,
} from "@linky-fit/ui";
import type { IconName } from "@linky-fit/ui";
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
import { useExperimentalFeatures } from "../app/hooks/useExperimentalFeatures";
import { usePushNotificationsSetting } from "../app/hooks/usePushNotificationsSetting";

import { useColorModePreference } from "../hooks/useColorMode";
import { navigateTo } from "../hooks/useRouting";
import type { I18nKey } from "../i18n";
import {
  connectionStatus,
  type ConnectionState,
} from "../utils/connectionStatus";
import { isDesktopShell, isNightlyOrigin } from "../platform/runtime";
import { COLOR_MODE_PREFERENCE_LABEL_KEYS } from "../utils/colorMode";
import { pickFile } from "../utils/pickFile";
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
    lightningInvoiceAutoPayLimit,
    logoutArmed,
    payWithCashuEnabled,
    pushToast,
    receiveMethod,
    relayUrls,
    requestLogout,
    requestPasteNostrKeys,
    seedMnemonic,
    setPayWithCashuEnabled,
  } = useAdvancedSettingsContext();
  const { allowTestMints, setAllowTestMints } = useMintSettingsContext();
  const { experimentalFeatures, setExperimentalFeatures } =
    useExperimentalFeatures();
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
  const colorModePreference = useColorModePreference();
  const [armedSecurityAction, setArmedSecurityAction] = useState<
    "copyNostr" | "pasteNostr" | null
  >(null);
  const armTimeoutRef = useRef<number | null>(null);
  const hasSeedMnemonic = (seedMnemonic ?? "").trim().length > 0;
  const hasCurrentNsec = (currentNsec ?? "").trim().length > 0;
  const appVersionLabel = [
    __APP_VERSION__,
    isNightlyOrigin() ? "nightly" : "",
    __APP_COMMIT_SHA__ ? `(${__APP_COMMIT_SHA__})` : "",
  ]
    .filter(Boolean)
    .join(" ");

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

  const linkRow = (
    icon: IconName,
    title: string,
    onPress: () => void,
    trailing?: React.ReactNode,
  ) => (
    <ListRow icon={icon} title={title} onPress={onPress} trailing={trailing} />
  );
  const toggleRow = (
    icon: IconName,
    title: string,
    value: boolean,
    onValueChange: (value: boolean) => void,
    disabled?: boolean,
  ) => (
    <ListRow
      icon={icon}
      title={title}
      trailing={
        <Switch
          accessibilityLabel={title}
          value={value}
          onValueChange={onValueChange}
          disabled={disabled}
        />
      }
    />
  );
  const valueText = (text: string) => (
    <Text variant="label" color="$colorMuted" numberOfLines={1}>
      {text}
    </Text>
  );
  const connectionState = (
    connected: number,
    total: number,
    state: ConnectionState,
  ) => (
    <Row gap="$sm">
      {valueText(`${connected}/${total}`)}
      <StatusDot
        tone={connectionStatus[state].tone}
        accessibilityLabel={t(connectionStatus[state].labelKey)}
      />
    </Row>
  );

  return (
    <Stack gap="$lg">
      <Section title={t("settingsGeneral")}>
        {linkRow("Languages", t("language"), () =>
          navigateTo({ route: "settingsLanguage" }),
        )}
        {linkRow(
          "Palette",
          t("appearance"),
          () => navigateTo({ route: "settingsAppearance" }),
          valueText(t(COLOR_MODE_PREFERENCE_LABEL_KEYS[colorModePreference])),
        )}
        {linkRow("Bitcoin", t("unit"), () =>
          navigateTo({ route: "settingsUnits" }),
        )}
        {linkRow("MessageCircle", t("feedback"), openFeedbackContact)}
        {/* Electron has no Web Push service; the running desktop app notifies. */}
        {isDesktopShell()
          ? null
          : toggleRow(
              "Bell",
              t("notifications"),
              notifications.enabled,
              (checked) => void notifications.setEnabled(checked),
              !currentNsec || notifications.isBusy,
            )}
        {toggleRow(
          "CheckCheck",
          t("sendReadReceipts"),
          sendReadReceiptsEnabled,
          toggleSendReadReceipts,
        )}
        {toggleRow(
          "Smartphone",
          t("showProfileQrOnTilt"),
          showProfileQrOnTiltEnabled,
          toggleShowProfileQrOnTilt,
        )}
      </Section>

      <Divider />

      <Section title={t("settingsPayments")}>
        {linkRow(
          "QrCode",
          t("receiveMethod"),
          () => navigateTo({ route: "settingsReceiveMethod" }),
          valueText(t(RECEIVE_METHOD_LABEL_KEYS[receiveMethod])),
        )}
        {toggleRow(
          "Bean",
          t("preferCashu"),
          payWithCashuEnabled,
          setPayWithCashuEnabled,
        )}
        {linkRow(
          "Zap",
          t("lightningInvoiceAutoPayLimit"),
          () => navigateTo({ route: "advancedAutoPayLimit" }),
          valueText(getAutoPayLimitLabel(lightningInvoiceAutoPayLimit)),
        )}
      </Section>

      <Divider />

      <Section title={t("settingsNetwork")}>
        {linkRow(
          "RadioTower",
          "Nostr",
          () => navigateTo({ route: "nostrRelays" }),
          connectionState(
            connectedRelayCount,
            relayUrls.length,
            nostrRelayOverallStatus,
          ),
        )}
        {linkRow(
          "Cloud",
          "Evolu",
          () => navigateTo({ route: "evoluServers" }),
          connectionState(
            evoluConnectedServerCount,
            evoluServerUrls.length,
            evoluOverallStatus,
          ),
        )}
        {linkRow(
          "Landmark",
          "Mint",
          () => navigateTo({ route: "mints" }),
          defaultMintDisplay ? valueText(defaultMintDisplay) : null,
        )}
        {toggleRow(
          "FlaskConical",
          t("allowTestMints"),
          allowTestMints,
          (checked) =>
            void setAllowTestMints(checked).then((outcome) => {
              if (!outcome.ok) pushToast(outcome.error);
            }),
        )}
      </Section>

      <Divider />

      <Section title={t("settingsDebug")}>
        {linkRow("Coins", t("tokens"), () =>
          navigateTo({ route: "cashuTokens" }),
        )}
        {linkRow("Upload", t("exportData"), exportAppData)}
        {linkRow("Download", t("importData"), () => {
          void pickFile(".txt,.json,application/json,text/plain").then(
            handleImportAppDataFilePicked,
          );
        })}
        <ListRow
          icon="BrushCleaning"
          title={t("dedupeContacts")}
          onPress={() => void dedupeContacts()}
          trailing={dedupeContactsIsBusy ? <Spinner /> : null}
          disabled={dedupeContactsIsBusy}
        />
        {linkRow("RotateCw", t("reloadApp"), () => void handleReloadApp())}
        {linkRow("Bug", t("nostrInspector"), () =>
          navigateTo({ route: "advancedInspector" }),
        )}
        {toggleRow(
          "FlaskConical",
          t("experimentalFeatures"),
          experimentalFeatures,
          (checked) =>
            void setExperimentalFeatures(checked).then((outcome) => {
              if (!outcome.ok) pushToast(outcome.error);
            }),
        )}
      </Section>

      <Divider />

      <Section title={t("settingsSecurity")}>
        <ListRow
          icon="ShieldCheck"
          title={t("masterKeys")}
          testID="open-master-keys"
          onPress={() => navigateTo({ route: "settingsMasterKeys" })}
          disabled={!hasSeedMnemonic}
        />
        <ListRow
          icon="Copy"
          title={t("copyNostrKeys")}
          testID="copy-nostr-keys"
          destructive={armedSecurityAction === "copyNostr"}
          onPress={() => requestSecurityAction("copyNostr", copyNostrKeys)}
          disabled={!hasCurrentNsec}
        />
        <ListRow
          icon="UserRound"
          title={t("pasteCustomNostrKeys")}
          destructive={armedSecurityAction === "pasteNostr"}
          onPress={() =>
            requestSecurityAction(
              "pasteNostr",
              requestPasteNostrKeys,
              "nostrPasteArmedHint",
            )
          }
          disabled={!hasCurrentNsec || !hasSeedMnemonic}
        />
        <ListRow
          icon="LogOut"
          title={t("logout")}
          destructive={logoutArmed}
          onPress={() =>
            requestLogout({
              evoluConnected: evoluOverallStatus === "connected",
            })
          }
        />
      </Section>

      {experimentalFeatures ? (
        <>
          <Divider />
          <Section title={t("settingsExperimental")}>
            {linkRow("Megaphone", t("keryxNewsletters"), () =>
              navigateTo({ route: "keryxCompanies" }),
            )}
          </Section>
        </>
      ) : null}

      <Text
        variant="caption"
        color="$colorMuted"
        textAlign="center"
        paddingTop="$lg"
      >
        {appVersionLabel}
      </Text>
    </Stack>
  );
}
