import {
  AvatarGroup,
  Button,
  Dialog,
  Divider,
  Icon,
  ListRow,
  Pill,
  Row,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  type IconName,
} from "@linky-fit/ui";
import React from "react";
import {
  useAppShellActions,
  useAppShellCore,
} from "../app/context/AppShellContexts";
import { useAdvancedSettingsContext } from "../app/context/SystemSettingsContexts";
import {
  useBeacon,
  useBeaconSupport,
  type UseBeacon,
} from "../app/hooks/useBeacon";
import { usePushNotificationsSetting } from "../app/hooks/usePushNotificationsSetting";
import type { ProxyPaymentPayerContact } from "../app/types/appTypes";
import { navigateTo } from "../hooks/useRouting";
import type { I18nKey, Translate } from "../i18n";
import {
  PROFILE_STATUS_CURRENCIES,
  type ProfileStatusCurrency,
} from "../nostrStatus";
const CURRENCY_LABEL_KEYS: Record<ProfileStatusCurrency, I18nKey> = {
  BRL: "proxyPaymentsProvideBrl",
  CZK: "proxyPaymentsProvideCzk",
  EUR: "proxyPaymentsProvideEur",
};

function PayerRow({
  currency,
  payers,
}: {
  currency: ProfileStatusCurrency;
  payers: readonly ProxyPaymentPayerContact[];
}): React.ReactElement {
  const people = payers.map(({ contact, pictureUrl }) => ({
    name: (contact.name ?? "").trim(),
    uri: pictureUrl ?? undefined,
  }));
  return (
    <Row>
      {/* Pill aligns itself to the top; its own box lets the row center it. */}
      <Stack>
        <Pill label={currency} size="sm" />
      </Stack>
      <AvatarGroup people={people} />
      <Text
        variant="label"
        color="$colorMuted"
        numberOfLines={1}
        flexShrink={1}
      >
        {people.map(({ name }) => name).join(", ")}
      </Text>
    </Row>
  );
}

const TRADE_LABEL_KEYS = {
  none: "beaconTradeNone",
  buy: "beaconTradeBuy",
  sell: "beaconTradeSell",
} as const satisfies Record<UseBeacon["trade"], I18nKey>;

const beaconStatusText = (
  { enabled, permission, status, keyCount }: UseBeacon,
  t: Translate,
): string => {
  if (!enabled) return t("beaconStatusOff");
  if (permission !== "granted") return t("beaconStatusPermissionNeeded");
  if (!status.bluetoothOn || status.error === "bluetooth_unavailable")
    return t("beaconStatusBluetoothOff");
  if (!status.running || status.error?.startsWith("advertise_failed_"))
    return t("beaconStatusNotBroadcasting");
  return t("beaconStatusBroadcasting").replace("{count}", String(keyCount));
};

const BEACON_INTRO_POINTS: ReadonlyArray<{ icon: IconName; key: I18nKey }> = [
  { icon: "Users", key: "beaconIntroContacts" },
  { icon: "ShieldCheck", key: "beaconIntroNpub" },
  { icon: "Bell", key: "beaconIntroBluetooth" },
];

function BeaconIntro({
  open,
  onClose,
  onTurnOn,
  t,
}: {
  open: boolean;
  onClose: () => void;
  onTurnOn: () => void;
  t: Translate;
}): React.ReactElement {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t("beacon")}
      closeLabel={t("close")}
      fullScreen
      actions={
        <>
          <Button icon="Radio" onPress={onTurnOn}>
            {t("beaconTurnOn")}
          </Button>
          <Button variant="ghost" onPress={onClose}>
            {t("beaconNotNow")}
          </Button>
        </>
      }
    >
      <Stack flex={1} justifyContent="center" gap="$xxl">
        <Stack
          alignSelf="center"
          padding="$xl"
          borderRadius="$pill"
          backgroundColor="$accentSoft"
        >
          <Icon name="Radio" size="xl" color="$accentText" />
        </Stack>
        <Stack gap="$lg">
          {BEACON_INTRO_POINTS.map(({ icon, key }) => (
            <Row key={key} gap="$md" alignItems="flex-start">
              <Icon name={icon} color="$accentText" />
              <Text flex={1} color="$colorSubtle">
                {t(key)}
              </Text>
            </Row>
          ))}
        </Stack>
      </Stack>
    </Dialog>
  );
}

/** The beacon switch and the trade it carries; the intro shows before the first switch-on. */
export function NearbyBeaconSection({
  t,
}: {
  t: Translate;
}): React.ReactElement {
  const beacon = useBeacon();
  const [introOpen, setIntroOpen] = React.useState(false);

  const setEnabled = (enabled: boolean) => {
    if (enabled && !beacon.introSeen) {
      setIntroOpen(true);
      return;
    }
    void beacon.setEnabled(enabled);
  };
  const turnOn = () => {
    setIntroOpen(false);
    beacon.markIntroSeen();
    void beacon.setEnabled(true);
  };

  return (
    <Stack gap="$sm">
      <Text variant="title" role="heading">
        {t("nearby")}
      </Text>
      <ListRow
        icon="Radio"
        title={t("beacon")}
        description={beaconStatusText(beacon, t)}
        trailing={
          <Switch
            accessibilityLabel={t("beacon")}
            value={beacon.enabled}
            onValueChange={setEnabled}
          />
        }
      />
      <Stack gap="$xs">
        <Text variant="label">{t("beaconTrade")}</Text>
        <SegmentedControl
          accessibilityLabel={t("beaconTrade")}
          value={beacon.trade}
          onValueChange={beacon.setTrade}
          options={(["none", "buy", "sell"] as const).map((value) => ({
            value,
            label: t(TRADE_LABEL_KEYS[value]),
            disabled: !beacon.enabled,
          }))}
        />
      </Stack>
      <Text variant="label" fontWeight="$regular" color="$colorMuted">
        {t("beaconMutualOnly")}
      </Text>
      <BeaconIntro
        open={introOpen}
        onClose={() => setIntroOpen(false)}
        onTurnOn={turnOn}
        t={t}
      />
    </Stack>
  );
}

export function ProxyPaymentsPage(): React.ReactElement {
  const {
    currentNsec,
    profileStatusIsSaving,
    proxyPaymentPayerContacts,
    selectedProfileStatusCurrencies,
    t,
  } = useAppShellCore();
  const { openWalletScan, toggleProfileStatusCurrency } = useAppShellActions();
  const { pushToast } = useAdvancedSettingsContext();
  const notifications = usePushNotificationsSetting();
  const beaconSupported = useBeaconSupport();
  // The currency whose switch waits for the user to confirm enabling
  // notifications first.
  const [pendingCurrency, setPendingCurrency] =
    React.useState<ProfileStatusCurrency | null>(null);

  const payersByCurrency = PROFILE_STATUS_CURRENCIES.map((currency) => ({
    currency,
    payers: proxyPaymentPayerContacts.filter(({ currencies }) =>
      currencies.includes(currency),
    ),
  })).filter(({ payers }) => payers.length > 0);

  const setCurrencyEnabled = (
    currency: ProfileStatusCurrency,
    enabled: boolean,
  ) => {
    if (enabled === selectedProfileStatusCurrencies.includes(currency)) return;
    // Friends ask for a payment through a push notification, so offering to
    // pay without notifications would only produce missed offers.
    if (enabled && !notifications.enabled) {
      setPendingCurrency(currency);
      return;
    }
    void toggleProfileStatusCurrency(currency);
  };
  const confirmNotifications = async () => {
    const currency = pendingCurrency;
    setPendingCurrency(null);
    if (!currency) return;
    const notificationsEnabled = await notifications.setEnabled(true);
    if (!notificationsEnabled) {
      pushToast(t("proxyPaymentsNotificationsRequired"));
      return;
    }
    await toggleProfileStatusCurrency(currency);
  };
  return (
    <Stack gap="$xxxl">
      <Stack gap="$sm">
        <Text variant="heading" role="heading">
          {t("proxyPaymentsHeroTitle")}
        </Text>
        <Text color="$colorMuted">{t("proxyPaymentsHeroBody")}</Text>
      </Stack>

      <Row gap="$sm">
        <Button
          icon="ScanLine"
          flex={1}
          flexDirection="column"
          paddingVertical="$xl"
          onPress={openWalletScan}
        >
          {t("proxyPaymentsScanBankQr")}
        </Button>
        <Button
          icon="PencilLine"
          variant="secondary"
          flex={1}
          flexDirection="column"
          paddingVertical="$xl"
          onPress={() => navigateTo({ route: "bankPaymentNew" })}
        >
          {t("proxyPaymentsEnterManually")}
        </Button>
      </Row>

      <Stack gap="$sm">
        <Text variant="title" role="heading">
          {t("proxyPaymentsPayersTitle")}
        </Text>
        {payersByCurrency.length === 0 ? (
          <Text color="$colorMuted">{t("proxyPaymentsPayersEmpty")}</Text>
        ) : (
          payersByCurrency.map(({ currency, payers }) => (
            <PayerRow key={currency} currency={currency} payers={payers} />
          ))
        )}
      </Stack>

      <Divider />

      <Stack gap="$sm">
        <Text variant="title" role="heading">
          {t("proxyPaymentsEarnTitle")}
        </Text>
        <Text color="$colorMuted">{t("proxyPaymentsEarnBody")}</Text>

        {PROFILE_STATUS_CURRENCIES.map((currency) => (
          <ListRow
            key={currency}
            leading={
              // Same box as PayerRow, wide enough that the titles line up
              // behind pills of different widths.
              <Stack minWidth="$control">
                <Pill label={currency} size="sm" />
              </Stack>
            }
            title={t(CURRENCY_LABEL_KEYS[currency])}
            trailing={
              <Switch
                accessibilityLabel={t(CURRENCY_LABEL_KEYS[currency])}
                value={selectedProfileStatusCurrencies.includes(currency)}
                disabled={
                  !currentNsec || profileStatusIsSaving || notifications.isBusy
                }
                onValueChange={(checked) =>
                  setCurrencyEnabled(currency, checked)
                }
              />
            }
          />
        ))}

        {selectedProfileStatusCurrencies.length > 0 ? (
          <Text variant="label" color="$accentText">
            {t("proxyPaymentsEarnActive")}
          </Text>
        ) : null}
      </Stack>

      {beaconSupported ? (
        <>
          <Divider />
          <NearbyBeaconSection t={t} />
        </>
      ) : null}

      <Dialog
        open={pendingCurrency !== null}
        onOpenChange={(open) => {
          if (!open) setPendingCurrency(null);
        }}
        title={t("notifications")}
        description={t("proxyPaymentsNotificationsHint")}
        actions={
          <>
            <Button onPress={() => void confirmNotifications()}>
              {t("enable")}
            </Button>
            <Button
              variant="secondary"
              onPress={() => setPendingCurrency(null)}
            >
              {t("payCancel")}
            </Button>
          </>
        }
      />
    </Stack>
  );
}
