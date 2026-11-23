import {
  Icon,
  ListRow,
  Row,
  Section,
  Stack,
  StatusDot,
  Switch,
  Text,
} from "@linky-fit/ui";
import type { IconName } from "@linky-fit/ui";
import React, { useCallback } from "react";
import { useAtom, useAtomValue } from "@linky-fit/linkstr-react";
import { useEvoluStatusSummary } from "../app/hooks/settings/useEvoluSettings";
import { useIdentitySettings } from "../app/hooks/settings/useIdentitySettings";
import {
  useDisplayAmounts,
  usePushToast,
  useTranslation,
} from "../app/hooks/shell";
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
import { LogoutRow } from "../components/LogoutRow";
import { currentNsecAtom } from "../app/state/session/session";
import { useAllowTestMints } from "../app/hooks/useAllowTestMints";
import {
  countConnectedRelays,
  overallRelayStatus,
  useRelayHealth,
} from "../app/hooks/useRelayHealth";
import { usePassOnListings } from "../app/hooks/usePassOnListings";
import { usePushNotificationsSetting } from "../app/hooks/usePushNotificationsSetting";
import { useColorModePreference } from "../hooks/useColorMode";
import { navigateTo, useRouting } from "../hooks/useRouting";
import { supportsDeviceMotion } from "../platform/deviceMotion";
import type { Route } from "../types/route";
import {
  connectionStatus,
  type ConnectionState,
} from "../utils/connectionStatus";
import { getDisplayUnitLabel } from "../utils/displayAmounts";
import { isDesktopShell, isNightlyOrigin } from "../platform/runtime";
import { COLOR_MODE_PREFERENCE_LABEL_KEYS } from "../utils/colorMode";
import { RECEIVE_METHOD_LABEL_KEYS } from "../utils/receiveMethod";
import { LANGUAGE_LABEL_KEYS } from "./LanguagePage";

export function AdvancedPage(): React.ReactElement {
  const route = useRouting();
  const { requestLogout, seedMnemonic } = useIdentitySettings();
  const defaultMintDisplay = useDefaultMintDisplay();
  const { evoluConnectedServerCount, evoluOverallStatus, evoluServerUrls } =
    useEvoluStatusSummary();
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
  const { passOnListings, setPassOnListings } = usePassOnListings();
  const relayHealth = useRelayHealth();
  const connectedRelayCount = countConnectedRelays(relayUrls, relayHealth);
  const nostrRelayOverallStatus = overallRelayStatus(relayUrls, relayHealth);

  const currentNsec = useAtomValue(currentNsecAtom);
  const { displayCurrency, formatDisplayedAmountParts } = useDisplayAmounts();
  const { lang, t } = useTranslation();
  const { sendReadReceiptsEnabled, toggleSendReadReceipts } =
    useSeenReceiptsSetting();
  const { showProfileQrOnTiltEnabled, toggleShowProfileQrOnTilt } =
    useTiltSetting();
  const openFeedbackContact = useOpenFeedbackContact();
  const notifications = usePushNotificationsSetting();
  const colorModePreference = useColorModePreference();
  const showTiltSetting = supportsDeviceMotion();
  const hasSeedMnemonic = (seedMnemonic ?? "").trim().length > 0;
  const hasCurrentNsec = (currentNsec ?? "").trim().length > 0;
  const currentUnitLabel =
    displayCurrency === "hidden"
      ? t("unitHidden")
      : getDisplayUnitLabel(displayCurrency, lang);
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

  /** Whether the detail pane beside the desktop list shows one of these routes. */
  const isOpen = (...kinds: Route["kind"][]) => kinds.includes(route.kind);
  const linkRow = (
    icon: IconName,
    title: string,
    onPress: () => void,
    options?: {
      active?: boolean | undefined;
      trailing?: React.ReactNode;
      value?: string | undefined;
    },
  ) => (
    <ListRow
      icon={icon}
      title={title}
      onPress={onPress}
      value={options?.value}
      trailing={options?.trailing}
      active={options?.active}
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
  const connectionState = (
    connected: number,
    total: number,
    state: ConnectionState,
  ) => (
    <Row gap="$sm">
      <Text
        variant="label"
        fontWeight="$regular"
        color="$colorMuted"
        numberOfLines={1}
      >
        {`${connected}/${total}`}
      </Text>
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
          {
            active: isOpen("settingsLanguage"),
            value: t(LANGUAGE_LABEL_KEYS[lang]),
          },
        )}
        {linkRow(
          "Palette",
          t("appearance"),
          () => navigateTo({ route: "settingsAppearance" }),
          {
            active: isOpen("settingsAppearance"),
            value: t(COLOR_MODE_PREFERENCE_LABEL_KEYS[colorModePreference]),
          },
        )}
        {linkRow(
          "Bitcoin",
          t("unit"),
          () => navigateTo({ route: "settingsUnits" }),
          {
            active: isOpen("settingsUnits"),
            value: currentUnitLabel,
          },
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
        {toggleRow(
          "Share2",
          t("passOnListings"),
          passOnListings,
          (checked) =>
            void setPassOnListings(checked).then((outcome) => {
              if (!outcome.ok) pushToast(outcome.error);
            }),
        )}
        {linkRow(
          "Ban",
          t("blocked"),
          () => navigateTo({ route: "settingsBlocked" }),
          { active: isOpen("settingsBlocked") },
        )}
        {showTiltSetting
          ? toggleRow(
              "Smartphone",
              t("showProfileQrOnTilt"),
              showProfileQrOnTiltEnabled,
              toggleShowProfileQrOnTilt,
            )
          : null}
      </Section>

      <Section grouped title={t("settingsAbout")}>
        {linkRow(
          "Compass",
          t("tutorial"),
          () => navigateTo({ route: "settingsTutorial" }),
          { active: isOpen("settingsTutorial") },
        )}
        {linkRow("MessageCircle", t("feedback"), openFeedbackContact)}
        <ListRow
          leading={<Icon name="HeartHandshake" size="sm" color="$accentText" />}
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
          { active: isOpen("settingsWhatsNew"), value: __APP_VERSION__ },
        )}
      </Section>

      <Section grouped title={t("settingsPayments")}>
        {linkRow(
          "QrCode",
          t("receiveMethod"),
          () => navigateTo({ route: "settingsReceiveMethod" }),
          {
            active: isOpen("settingsReceiveMethod"),
            value: t(RECEIVE_METHOD_LABEL_KEYS[receiveMethod]),
          },
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
          {
            active: isOpen("advancedAutoPayLimit"),
            value: getAutoPayLimitLabel(lightningInvoiceAutoPayLimit),
          },
        )}
      </Section>

      <Section grouped title={t("settingsNetwork")}>
        {linkRow(
          "RadioTower",
          "Nostr",
          () => navigateTo({ route: "nostrRelays" }),
          {
            active: isOpen("nostrRelays", "nostrRelay", "nostrRelayNew"),
            trailing: connectionState(
              connectedRelayCount,
              relayUrls.length,
              nostrRelayOverallStatus,
            ),
          },
        )}
        {linkRow(
          "Cloud",
          "Evolu",
          () => navigateTo({ route: "evoluServers" }),
          {
            active: isOpen(
              "evoluServers",
              "evoluServer",
              "evoluServerNew",
              "evoluCurrentData",
              "evoluHistoryData",
              "chatStorage",
            ),
            trailing: connectionState(
              evoluConnectedServerCount,
              evoluServerUrls.length,
              evoluOverallStatus,
            ),
          },
        )}
        {linkRow("Landmark", "Mint", () => navigateTo({ route: "mints" }), {
          active: isOpen("mints", "mint", "mintNew"),
          value: defaultMintDisplay || undefined,
        })}
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
        <LogoutRow
          evoluConnected={evoluOverallStatus === "connected"}
          onBackUpKeys={
            hasSeedMnemonic
              ? () => navigateTo({ route: "settingsMasterKeys" })
              : undefined
          }
          onConfirm={() =>
            requestLogout({
              evoluConnected: evoluOverallStatus === "connected",
            })
          }
          t={t}
        />
      </Section>

      <Section grouped>
        {linkRow(
          "Bug",
          t("settingsDeveloper"),
          () => navigateTo({ route: "advanced" }),
          {
            active: isOpen(
              "advanced",
              "advancedInspector",
              "advancedInspectorTimeline",
              "advancedPushDebug",
              "cashuTokens",
              "cashuToken",
              "cashuTokenNew",
              "cashuTokenEmit",
              "cashuProofs",
            ),
          },
        )}
      </Section>

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
