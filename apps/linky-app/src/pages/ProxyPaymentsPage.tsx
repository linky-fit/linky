import {
  Button,
  Dialog,
  Divider,
  ListRow,
  Pill,
  Row,
  Stack,
  Switch,
  Text,
} from "@linky-fit/ui";
import { useAtomValue } from "@linky-fit/linkstr-react";
import React from "react";
import { useProxyPaymentPayerContacts } from "../app/hooks/contacts/useDisplayContacts";
import { useProfileStatusEditor } from "../app/hooks/profile/useProfileStatusEditor";
import { usePushToast, useTranslation } from "../app/hooks/shell";
import { useScanCommands } from "../app/hooks/shell/scan";
import { usePushNotificationsSetting } from "../app/hooks/usePushNotificationsSetting";
import type { ProxyPaymentPayerContact } from "../app/types/appTypes";
import { PeopleRow } from "../components/PeopleRow";
import { navigateTo } from "../hooks/useRouting";
import type { I18nKey } from "../i18n";
import {
  PROFILE_STATUS_CURRENCIES,
  type ProfileStatusCurrency,
} from "../nostrStatus";
import { currentNsecAtom } from "../app/state/session/session";
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
  return (
    <PeopleRow
      leading={<Pill label={currency} size="sm" />}
      people={payers.map(({ contact, pictureUrl }) => ({
        name: contact.name ?? "",
        pictureUrl,
      }))}
    />
  );
}

export function ProxyPaymentsPage(): React.ReactElement {
  const { openWalletScan } = useScanCommands();
  const currentNsec = useAtomValue(currentNsecAtom);
  const {
    profileStatusIsSaving,
    selectedProfileStatusCurrencies,
    toggleProfileStatusCurrency,
  } = useProfileStatusEditor();
  const proxyPaymentPayerContacts = useProxyPaymentPayerContacts();
  const { t } = useTranslation();
  const pushToast = usePushToast();
  const notifications = usePushNotificationsSetting();
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
          data-guide="proxy-scan"
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

      <Stack gap="$sm" data-guide="proxy-earn">
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
