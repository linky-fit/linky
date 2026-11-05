import {
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
import React, { useCallback } from "react";
import { useAtom, useAtomValue } from "@linky-fit/linkstr-react";
import { useDedupeContacts } from "../app/hooks/contacts/useDedupeContacts";
import { useEvoluStatusSummary } from "../app/hooks/settings/useEvoluSettings";
import { useIdentitySettings } from "../app/hooks/settings/useIdentitySettings";
import {
  useDisplayAmounts,
  usePushToast,
  useTranslation,
} from "../app/hooks/shell";
import { useAppDataActions } from "../app/hooks/useAppDataTransfer";
import { useDefaultMintDisplay } from "../app/hooks/wallet/useDefaultMint";
import { nostrRelayUrlsAtom } from "../app/state/messages/relays";
import {
  lightningInvoiceAutoPayLimitAtom,
  payWithCashuEnabledAtom,
  receiveMethodAtom,
} from "../app/state/wallet/prefs";
import {
  useSeenReceiptsSetting,
  useTiltSetting,
} from "../app/hooks/settings/useDeviceSettings";
import { useOpenFeedbackContact } from "../app/hooks/useFeedbackContact";
import { currentNsecAtom } from "../app/state/session/session";
import { useAllowTestMints } from "../app/hooks/useAllowTestMints";
import {
  countConnectedRelays,
  overallRelayStatus,
  useRelayHealth,
} from "../app/hooks/useRelayHealth";
import { useExperimentalFeatures } from "../app/hooks/useExperimentalFeatures";
import { usePushNotificationsSetting } from "../app/hooks/usePushNotificationsSetting";
import { useColorModePreference } from "../hooks/useColorMode";
import { navigateTo, useRouting } from "../hooks/useRouting";
import type { Route } from "../types/route";
import {
  connectionStatus,
  type ConnectionState,
} from "../utils/connectionStatus";
import { isDesktopShell, isNightlyOrigin } from "../platform/runtime";
import { COLOR_MODE_PREFERENCE_LABEL_KEYS } from "../utils/colorMode";
import { pickFile } from "../utils/pickFile";
import { RECEIVE_METHOD_LABEL_KEYS } from "../utils/receiveMethod";

export function AdvancedPage(): React.ReactElement {
  const route = useRouting();
  const { logoutArmed, requestLogout, seedMnemonic } = useIdentitySettings();
  const { dedupeContacts, dedupeContactsIsBusy } = useDedupeContacts();
  const defaultMintDisplay = useDefaultMintDisplay();
  const { evoluConnectedServerCount, evoluOverallStatus, evoluServerUrls } =
    useEvoluStatusSummary();
  const { exportAppData, handleImportAppDataFilePicked } = useAppDataActions();
  const lightningInvoiceAutoPayLimit = useAtomValue(
    lightningInvoiceAutoPayLimitAtom,
  );
  const [payWithCashuEnabled, setPayWithCashuEnabled] = useAtom(
    payWithCashuEnabledAtom,
  );
  const pushToast = usePushToast();
  const receiveMethod = useAtomValue(receiveMethodAtom);
  const relayUrls = useAtomValue(nostrRelayUrlsAtom);
  const { allowTestMints, setAllowTestMints } = useAllowTestMints();
  const { experimentalFeatures, setExperimentalFeatures } =
    useExperimentalFeatures();
  const relayHealth = useRelayHealth();
  const connectedRelayCount = countConnectedRelays(relayUrls, relayHealth);
  const nostrRelayOverallStatus = overallRelayStatus(relayUrls, relayHealth);

  const currentNsec = useAtomValue(currentNsecAtom);
  const { formatDisplayedAmountParts } = useDisplayAmounts();
  const { t } = useTranslation();
  const { sendReadReceiptsEnabled, toggleSendReadReceipts } =
    useSeenReceiptsSetting();
  const { showProfileQrOnTiltEnabled, toggleShowProfileQrOnTilt } =
    useTiltSetting();
  const openFeedbackContact = useOpenFeedbackContact();
  const notifications = usePushNotificationsSetting();
  const colorModePreference = useColorModePreference();
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

  /** Whether the detail pane beside the desktop list shows one of these routes. */
  const isOpen = (...kinds: Route["kind"][]) => kinds.includes(route.kind);
  const linkRow = (
    icon: IconName,
    title: string,
    onPress: () => void,
    trailing?: React.ReactNode,
    active = false,
  ) => (
    <ListRow
      icon={icon}
      title={title}
      onPress={onPress}
      trailing={trailing}
      active={active}
    />
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
    <Stack gap="$xl">
      <Section grouped title={t("settingsGeneral")}>
        {linkRow(
          "Languages",
          t("language"),
          () => navigateTo({ route: "settingsLanguage" }),
          undefined,
          isOpen("settingsLanguage"),
        )}
        {linkRow(
          "Palette",
          t("appearance"),
          () => navigateTo({ route: "settingsAppearance" }),
          valueText(t(COLOR_MODE_PREFERENCE_LABEL_KEYS[colorModePreference])),
          isOpen("settingsAppearance"),
        )}
        {linkRow(
          "Bitcoin",
          t("unit"),
          () => navigateTo({ route: "settingsUnits" }),
          undefined,
          isOpen("settingsUnits"),
        )}
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
        {linkRow(
          "Ban",
          t("blocked"),
          () => navigateTo({ route: "settingsBlocked" }),
          undefined,
          isOpen("settingsBlocked"),
        )}
        {toggleRow(
          "Smartphone",
          t("showProfileQrOnTilt"),
          showProfileQrOnTiltEnabled,
          toggleShowProfileQrOnTilt,
        )}
      </Section>

      <Section grouped title={t("settingsAbout")}>
        {linkRow(
          "Compass",
          t("tutorial"),
          () => navigateTo({ route: "settingsTutorial" }),
          undefined,
          isOpen("settingsTutorial"),
        )}
        {linkRow("MessageCircle", t("feedback"), openFeedbackContact)}
        <ListRow
          icon="HeartHandshake"
          iconTone="accent"
          title={
            <Text bold color="$accentText">
              {t("supportLinky")}
            </Text>
          }
          testID="open-support-linky"
          onPress={() => navigateTo({ route: "settingsSupport" })}
          active={isOpen("settingsSupport")}
        />
        {linkRow(
          "Newspaper",
          t("whatsNew"),
          () => navigateTo({ route: "settingsWhatsNew" }),
          valueText(__APP_VERSION__),
          isOpen("settingsWhatsNew"),
        )}
      </Section>

      <Section grouped title={t("settingsPayments")}>
        {linkRow(
          "QrCode",
          t("receiveMethod"),
          () => navigateTo({ route: "settingsReceiveMethod" }),
          valueText(t(RECEIVE_METHOD_LABEL_KEYS[receiveMethod])),
          isOpen("settingsReceiveMethod"),
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
          isOpen("advancedAutoPayLimit"),
        )}
      </Section>

      <Section grouped title={t("settingsNetwork")}>
        {linkRow(
          "RadioTower",
          "Nostr",
          () => navigateTo({ route: "nostrRelays" }),
          connectionState(
            connectedRelayCount,
            relayUrls.length,
            nostrRelayOverallStatus,
          ),
          isOpen("nostrRelays", "nostrRelay", "nostrRelayNew"),
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
          isOpen(
            "evoluServers",
            "evoluServer",
            "evoluServerNew",
            "evoluData",
            "evoluCurrentData",
            "evoluHistoryData",
            "chatStorage",
          ),
        )}
        {linkRow(
          "Landmark",
          "Mint",
          () => navigateTo({ route: "mints" }),
          defaultMintDisplay ? valueText(defaultMintDisplay) : null,
          isOpen("mints", "mint", "mintNew"),
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

      <Section grouped title={t("settingsDebug")}>
        {linkRow(
          "Coins",
          t("tokens"),
          () => navigateTo({ route: "cashuTokens" }),
          undefined,
          isOpen(
            "cashuTokens",
            "cashuToken",
            "cashuTokenNew",
            "cashuTokenEmit",
            "cashuProofs",
          ),
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
        {linkRow(
          "Bug",
          t("nostrInspector"),
          () => navigateTo({ route: "advancedInspector" }),
          undefined,
          isOpen("advancedInspector", "advancedInspectorTimeline"),
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

      <Section grouped title={t("settingsSecurity")}>
        <ListRow
          icon="ShieldCheck"
          title={t("masterKeys")}
          testID="open-master-keys"
          onPress={() => navigateTo({ route: "settingsMasterKeys" })}
          active={isOpen("settingsMasterKeys")}
          disabled={!hasSeedMnemonic}
        />
        <ListRow
          icon="KeyRound"
          title={t("nostrIdentity")}
          testID="open-nostr-identity"
          onPress={() => navigateTo({ route: "settingsNostrIdentity" })}
          active={isOpen("settingsNostrIdentity")}
          disabled={!hasCurrentNsec}
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
          <Section grouped title={t("settingsExperimental")}>
            {linkRow(
              "Megaphone",
              t("keryxNewsletters"),
              () => navigateTo({ route: "keryxCompanies" }),
              undefined,
              isOpen(
                "keryxCompanies",
                "keryxCompany",
                "keryxCompanyNew",
                "keryxAnnouncement",
              ),
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
