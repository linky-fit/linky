import { Banknote, Euro, PencilLine, ScanLine } from "lucide-react";
import React from "react";
import {
  useAppShellActions,
  useAppShellCore,
} from "../app/context/AppShellContexts";
import { useAdvancedSettingsContext } from "../app/context/SystemSettingsContexts";
import { usePushNotificationsSetting } from "../app/hooks/usePushNotificationsSetting";
import type { ProxyPaymentPayerContact } from "../app/types/appTypes";
import { Avatar } from "../components/Avatar";
import { SettingsToggleRow } from "../components/SettingsRows";
import { navigateTo } from "../hooks/useRouting";
import type { I18nKey } from "../i18n";
import {
  PROFILE_STATUS_CURRENCIES,
  type ProfileStatusCurrency,
} from "../nostrStatus";
import { getInitials } from "../utils/formatting";

const CURRENCY_LABEL_KEYS: Record<ProfileStatusCurrency, I18nKey> = {
  CZK: "proxyPaymentsProvideCzk",
  EUR: "proxyPaymentsProvideEur",
};

const CURRENCY_ICONS: Record<ProfileStatusCurrency, React.ReactNode> = {
  CZK: <Banknote size={18} />,
  EUR: <Euro size={18} />,
};

const MAX_PAYER_AVATARS = 5;

function PayerRow({
  currency,
  payers,
}: {
  currency: ProfileStatusCurrency;
  payers: readonly ProxyPaymentPayerContact[];
}): React.ReactElement {
  const names = payers.map(({ contact }) => (contact.name ?? "").trim());
  return (
    <li className="proxy-payments-payer-row">
      <span className="proxy-payments-currency">{currency}</span>
      <span className="proxy-payments-avatars" aria-hidden="true">
        {payers.slice(0, MAX_PAYER_AVATARS).map(({ contact, pictureUrl }) => (
          <span
            key={contact.id ?? contact.npub}
            className="proxy-payments-avatar"
          >
            <Avatar
              pictureUrl={pictureUrl}
              fallback={getInitials((contact.name ?? "").trim())}
              fallbackClassName=""
            />
          </span>
        ))}
        {payers.length > MAX_PAYER_AVATARS ? (
          <span className="proxy-payments-avatar proxy-payments-avatar-more">
            +{payers.length - MAX_PAYER_AVATARS}
          </span>
        ) : null}
      </span>
      <span className="proxy-payments-payer-names">{names.join(", ")}</span>
    </li>
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
    <section className="panel panel-plain proxy-payments-page">
      <header className="proxy-payments-hero">
        <h1>{t("proxyPaymentsHeroTitle")}</h1>
        <p>{t("proxyPaymentsHeroBody")}</p>
      </header>

      <div className="proxy-payments-actions">
        <button
          type="button"
          className="contacts-qr-btn"
          onClick={openWalletScan}
        >
          <span className="contacts-qr-btn-icon" aria-hidden="true">
            <ScanLine size={18} strokeWidth={2} />
          </span>
          <span className="contacts-qr-btn-label">
            {t("proxyPaymentsScanBankQr")}
          </span>
        </button>
        <button
          type="button"
          className="contacts-qr-btn secondary"
          onClick={() => navigateTo({ route: "bankPaymentNew" })}
        >
          <span className="contacts-qr-btn-icon" aria-hidden="true">
            <PencilLine size={18} strokeWidth={2} />
          </span>
          <span className="contacts-qr-btn-label">
            {t("proxyPaymentsEnterManually")}
          </span>
        </button>
      </div>

      <section className="proxy-payments-section">
        <h2>{t("proxyPaymentsPayersTitle")}</h2>
        {payersByCurrency.length === 0 ? (
          <p>{t("proxyPaymentsPayersEmpty")}</p>
        ) : (
          <ul className="proxy-payments-payers">
            {payersByCurrency.map(({ currency, payers }) => (
              <PayerRow key={currency} currency={currency} payers={payers} />
            ))}
          </ul>
        )}
      </section>

      <section className="proxy-payments-section proxy-payments-earn">
        <h2>{t("proxyPaymentsEarnTitle")}</h2>
        <p>{t("proxyPaymentsEarnBody")}</p>

        {PROFILE_STATUS_CURRENCIES.map((currency) => (
          <SettingsToggleRow
            key={currency}
            icon={CURRENCY_ICONS[currency]}
            label={t(CURRENCY_LABEL_KEYS[currency])}
            checked={selectedProfileStatusCurrencies.includes(currency)}
            disabled={
              !currentNsec || profileStatusIsSaving || notifications.isBusy
            }
            onChange={(checked) => setCurrencyEnabled(currency, checked)}
          />
        ))}

        {selectedProfileStatusCurrencies.length > 0 ? (
          <p className="proxy-payments-earn-active">
            {t("proxyPaymentsEarnActive")}
          </p>
        ) : null}
      </section>

      {pendingCurrency ? (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={t("notifications")}
          onClick={() => setPendingCurrency(null)}
        >
          <div
            className="modal-sheet"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-title">{t("notifications")}</div>
            <div className="modal-body">
              {t("proxyPaymentsNotificationsHint")}
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn-wide"
                onClick={() => void confirmNotifications()}
              >
                {t("enable")}
              </button>
              <button
                type="button"
                className="btn-wide secondary"
                onClick={() => setPendingCurrency(null)}
              >
                {t("payCancel")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
