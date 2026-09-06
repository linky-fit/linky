import type { ContactRowLike } from "../app/types/appTypes";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useFiatRates } from "../app/hooks/useFiatRates";
import {
  LINKY_BANK_PAYMENT_OFFER_MAX_STAGGER_DELAY_SEC,
  LINKY_BANK_PAYMENT_OFFER_MIN_STAGGER_DELAY_SEC,
  LINKY_BANK_PAYMENT_OFFER_STAGGER_DELAY_STEP_SEC,
} from "../app/lib/bankPaymentOffer";
import { Avatar } from "../components/Avatar";
import { BankPaymentAmount } from "../components/BankPaymentAmount";
import { SettingsStepper } from "../components/SettingsStepper";
import { navigateTo } from "../hooks/useRouting";
import type { I18nKey, Translate } from "../i18n";
import { formatDomesticBankAccount } from "../utils/bankAccount";
import type { FiatRates } from "../utils/displayAmounts";
import { formatInteger, getInitials } from "../utils/formatting";
import {
  getBankPaymentEditableFieldKeys,
  tryParseBankPayment,
  updateBankPaymentFields,
  type BankPayment,
  type BankPaymentFieldKey,
} from "../utils/spdPayment";

interface SpdPaymentPageProps {
  cashuBalanceAfterMelt: number;
  initialOfferContactCount: number;
  initialOfferDelaySec: number;
  isEditing: boolean;
  offerContacts: readonly (ContactRowLike & {
    lastBankPaymentResponseSec?: number | null;
    pictureUrl?: string | null;
  })[];
  onRequestReimbursement: (args: {
    amountSat: number | null;
    amountText: string;
    contacts: ContactRowLike[];
    spdPayload: string;
    staggerDelaySec: number;
  }) => Promise<{ chatId: string; offerId: string } | null>;
  spdPayload: string;
}

interface SpdPaymentFieldRow {
  key: string;
  label: string;
  value: string;
}

const getSpdField = (payment: BankPayment, key: string): string =>
  (payment.fields[key] ?? "").trim();

// Czech and Slovak accounts are shown the way their banks display them.
const getDisplayedFieldValue = (payment: BankPayment, key: string): string => {
  const value = getSpdField(payment, key);
  return key === "ACC" ? (formatDomesticBankAccount(value) ?? value) : value;
};

const SATS_PER_BTC = 100_000_000;

const getOfferContactKey = (contact: ContactRowLike): string => {
  const id = (contact.id ?? "").trim();
  if (id) return `id:${id}`;
  return `npub:${(contact.npub ?? "").trim()}`;
};

// Selection keeps insertion order: the offer is extended to recipients in
// this order when a stagger delay is set.
const getInitialOfferContactKeys = (
  contacts: SpdPaymentPageProps["offerContacts"],
  count: number,
): string[] =>
  contacts.slice(0, Math.max(0, count)).map(getOfferContactKey).filter(Boolean);

const clampOfferDelaySec = (value: number): number => {
  if (!Number.isFinite(value))
    return LINKY_BANK_PAYMENT_OFFER_MIN_STAGGER_DELAY_SEC;
  return Math.min(
    LINKY_BANK_PAYMENT_OFFER_MAX_STAGGER_DELAY_SEC,
    Math.max(LINKY_BANK_PAYMENT_OFFER_MIN_STAGGER_DELAY_SEC, Math.trunc(value)),
  );
};

const formatResponseDuration = (durationSec: number): string => {
  const safeDurationSec = Math.max(0, Math.trunc(durationSec));
  const minutes = Math.floor(safeDurationSec / 60);
  const seconds = safeDurationSec % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

const getRateForCurrency = (
  currency: string,
  fiatRates: FiatRates,
): number | null => {
  switch (currency.toUpperCase()) {
    case "CHF":
      return fiatRates.chfPerBtc;
    case "CZK":
      return fiatRates.czkPerBtc;
    case "EUR":
      return fiatRates.eurPerBtc;
    case "USD":
      return fiatRates.usdPerBtc;
    default:
      return null;
  }
};

const parseSpdAmount = (value: string): number | null => {
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;

  const amount = Number.parseFloat(normalized);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount;
};

const getSpdAmountSat = (
  payment: BankPayment,
  fiatRates: FiatRates | null,
): number | null => {
  const amount = parseSpdAmount(getSpdField(payment, "AM"));
  if (amount === null) return null;

  const currency = getSpdField(payment, "CC").toUpperCase();
  if (currency === "SAT" || currency === "SATS") {
    return Math.round(amount);
  }

  if (!fiatRates) return null;

  const rate = getRateForCurrency(currency, fiatRates);
  if (rate === null || rate <= 0) return null;

  const amountSat = Math.round((amount / rate) * SATS_PER_BTC);
  return Number.isFinite(amountSat) && amountSat > 0 ? amountSat : null;
};

const FIELD_LABEL_KEYS: Record<BankPaymentFieldKey, I18nKey> = {
  ACC: "spdPaymentAccount",
  AM: "spdPaymentAmount",
  BIC: "spdPaymentBic",
  DT: "spdPaymentDueDate",
  MSG: "spdPaymentMessage",
  RF: "spdPaymentReference",
  RN: "spdPaymentRecipient",
  "X-KS": "spdPaymentConstantSymbol",
  "X-SS": "spdPaymentSpecificSymbol",
  "X-VS": "spdPaymentVariableSymbol",
};

const buildSpdRows = (
  payment: BankPayment,
  t: Translate,
): SpdPaymentFieldRow[] =>
  getBankPaymentEditableFieldKeys(payment.format).flatMap((key) => {
    const value = getDisplayedFieldValue(payment, key);
    return value ? [{ key, label: t(FIELD_LABEL_KEYS[key]), value }] : [];
  });

type BankPaymentFields = Record<string, string>;

// `confirmed` edits are what the offer is built from; `draft` holds the form
// while the user is editing and becomes `confirmed` on confirm.
interface BankPaymentEdits {
  confirmed: BankPaymentFields | null;
  draft: BankPaymentFields | null;
  payload: string;
}

const createDraftFields = (payment: BankPayment): BankPaymentFields =>
  Object.fromEntries(
    ["AM", ...getBankPaymentEditableFieldKeys(payment.format)].map((key) => [
      key,
      getDisplayedFieldValue(payment, key),
    ]),
  );

interface BankPaymentEditError {
  field: string | null;
  key: I18nKey;
}

const EDIT_ERRORS: Record<string, BankPaymentEditError> = {
  "bank-payment-invalid-account": {
    field: "ACC",
    key: "spdPaymentInvalidAccount",
  },
  "bank-payment-invalid-amount": {
    field: "AM",
    key: "spdPaymentInvalidAmount",
  },
  "bank-payment-invalid-bic": { field: "BIC", key: "spdPaymentInvalidBic" },
  "spd-missing-account": { field: "ACC", key: "spdPaymentMissingAccount" },
};

const getEditError = (error: unknown): BankPaymentEditError =>
  (error instanceof Error ? EDIT_ERRORS[error.message] : undefined) ?? {
    field: null,
    key: "spdPaymentEditInvalid",
  };

const applyBankPaymentEdits = (
  payment: BankPayment,
  fields: BankPaymentFields | null,
): { error: BankPaymentEditError | null; payment: BankPayment | null } => {
  if (!fields) return { error: null, payment };
  try {
    return { error: null, payment: updateBankPaymentFields(payment, fields) };
  } catch (error) {
    return { error: getEditError(error), payment: null };
  }
};

export const SpdPaymentPage: React.FC<SpdPaymentPageProps> = ({
  cashuBalanceAfterMelt,
  initialOfferContactCount,
  initialOfferDelaySec,
  isEditing,
  offerContacts,
  onRequestReimbursement,
  spdPayload,
}) => {
  const { displayCurrency, displayUnit, formatDisplayedAmountText, lang, t } =
    useAppShellCore();
  const fiatRates = useFiatRates();
  const [isRequestingOffer, setIsRequestingOffer] = React.useState(false);
  const [offerStatus, setOfferStatus] = React.useState<string | null>(null);
  const [hasEditedOfferContacts, setHasEditedOfferContacts] =
    React.useState(false);
  const previousSpdPayloadRef = React.useRef(spdPayload);
  const [selectedOfferContactKeys, setSelectedOfferContactKeys] =
    React.useState<string[]>(() =>
      getInitialOfferContactKeys(offerContacts, initialOfferContactCount),
    );
  const [offerDelaySec, setOfferDelaySec] = React.useState<number>(() =>
    clampOfferDelaySec(initialOfferDelaySec),
  );
  const payment = React.useMemo(
    () => tryParseBankPayment(spdPayload),
    [spdPayload],
  );
  const [edits, setEdits] = React.useState<BankPaymentEdits | null>(null);
  // Edits belong to the payload they were started from; a new scan drops them.
  const activeEdits =
    payment && edits?.payload === payment.payload ? edits : null;
  const confirmedFields = activeEdits?.confirmed ?? null;
  // The edit form opens on the confirmed values (or the scanned ones) until
  // the first keystroke creates a draft.
  const draftFields = React.useMemo(
    () =>
      isEditing && payment
        ? (activeEdits?.draft ?? confirmedFields ?? createDraftFields(payment))
        : null,
    [activeEdits, confirmedFields, isEditing, payment],
  );
  const editedPayment = React.useMemo(
    () =>
      payment
        ? applyBankPaymentEdits(payment, draftFields ?? confirmedFields)
        : { error: null, payment: null },
    [confirmedFields, draftFields, payment],
  );

  // Leaving the form by navigation (topbar back, hardware back) cancels the
  // draft; only Confirm keeps it.
  React.useEffect(() => {
    if (isEditing) return;
    setEdits((current) =>
      current?.draft ? { ...current, draft: null } : current,
    );
  }, [isEditing]);
  const selectedOfferContacts = React.useMemo(
    () =>
      selectedOfferContactKeys.flatMap((key) => {
        const contact = offerContacts.find(
          (candidate) => getOfferContactKey(candidate) === key,
        );
        return contact ? [contact] : [];
      }),
    [offerContacts, selectedOfferContactKeys],
  );

  React.useEffect(() => {
    const paymentChanged = previousSpdPayloadRef.current !== spdPayload;
    if (!paymentChanged && hasEditedOfferContacts) return;
    previousSpdPayloadRef.current = spdPayload;
    if (paymentChanged) setHasEditedOfferContacts(false);
    setSelectedOfferContactKeys(
      getInitialOfferContactKeys(offerContacts, initialOfferContactCount),
    );
  }, [
    hasEditedOfferContacts,
    initialOfferContactCount,
    offerContacts,
    spdPayload,
  ]);

  if (!payment) {
    return (
      <section className="panel panel-plain bank-payment-page">
        <p className="muted bank-payment-hint">{t("spdPaymentInvalid")}</p>
      </section>
    );
  }

  const activePayment = editedPayment.payment;
  const amount = activePayment
    ? parseSpdAmount(getSpdField(activePayment, "AM"))
    : null;
  const currency = getSpdField(payment, "CC").toLowerCase();
  const amountSat = activePayment
    ? getSpdAmountSat(activePayment, fiatRates)
    : null;
  const amountText =
    displayCurrency === "hidden" && amount !== null
      ? "*****"
      : amount !== null && currency === displayCurrency
        ? `~${formatInteger(Math.round(amount), lang)} ${displayUnit}`
        : amountSat === null
          ? ""
          : formatDisplayedAmountText(amountSat);
  const rows = buildSpdRows(activePayment ?? payment, t);
  const editableKeys = getBankPaymentEditableFieldKeys(payment.format);
  const currencyCode = getSpdField(payment, "CC").toUpperCase();
  const editError = editedPayment.error;
  const updateDraftField = (key: string, value: string) =>
    setEdits((current) => {
      const own = current?.payload === payment.payload ? current : null;
      const base = own?.draft ?? own?.confirmed ?? createDraftFields(payment);
      return {
        confirmed: own?.confirmed ?? null,
        draft: { ...base, [key]: value },
        payload: payment.payload,
      };
    });
  const confirmEdits = () => {
    setEdits({ confirmed: draftFields, draft: null, payload: payment.payload });
    navigateTo({ route: "bankPayment", spdPayload });
  };
  const offerContactsCount = selectedOfferContacts.length;
  const hasEnoughCashuForProxy =
    amountSat !== null && amountSat <= cashuBalanceAfterMelt;
  const requestReimbursementLabel = !hasEnoughCashuForProxy
    ? t("payInsufficient")
    : offerContactsCount === 0
      ? t("spdPaymentNoOfferContact")
      : offerContactsCount === 1
        ? t("spdPaymentRequestReimbursementCountOne")
        : t("spdPaymentRequestReimbursementCountOther").replace(
            "{count}",
            String(offerContactsCount),
          );

  const requestReimbursement = async () => {
    if (
      !activePayment ||
      selectedOfferContacts.length === 0 ||
      !amountText ||
      !hasEnoughCashuForProxy ||
      isRequestingOffer
    ) {
      return;
    }

    setIsRequestingOffer(true);
    setOfferStatus(null);
    try {
      const offer = await onRequestReimbursement({
        amountSat,
        amountText,
        contacts: selectedOfferContacts,
        spdPayload: activePayment.payload,
        staggerDelaySec: offerDelaySec,
      });
      if (offer) {
        navigateTo({
          route: "bankPaymentOffer",
          chatId: offer.chatId,
          offerId: offer.offerId,
        });
        return;
      }
      setOfferStatus(t("spdPaymentOfferFailed"));
    } finally {
      setIsRequestingOffer(false);
    }
  };

  if (draftFields) {
    return (
      <section className="panel panel-plain bank-payment-page">
        <div className="bank-payment-summary">
          <BankPaymentAmount
            canCycle={Boolean(amountText)}
            text={amountText || t("spdPaymentAmountUnknown")}
          />
        </div>

        <div className="bank-payment-fields bank-payment-edit">
          {["AM" as const, ...editableKeys].map((key) => {
            const inputId = `bank-payment-field-${key}`;
            const suffix = key === "AM" ? currencyCode : "";
            const fieldError = editError?.field === key ? editError : null;
            return (
              <div className="bank-payment-edit-row" key={key}>
                <label htmlFor={inputId}>{t(FIELD_LABEL_KEYS[key])}</label>
                <div
                  className={
                    suffix
                      ? "input-with-public-value has-public-value"
                      : "input-with-public-value"
                  }
                >
                  <input
                    id={inputId}
                    aria-invalid={fieldError ? true : undefined}
                    inputMode={key === "AM" ? "decimal" : undefined}
                    value={draftFields[key] ?? ""}
                    onChange={(event) =>
                      updateDraftField(key, event.target.value)
                    }
                  />
                  {suffix ? (
                    <span className="input-public-value">{suffix}</span>
                  ) : null}
                </div>
                {fieldError ? (
                  <p className="bank-payment-error bank-payment-offer-status">
                    {t(fieldError.key)}
                  </p>
                ) : null}
              </div>
            );
          })}
          {editError && editError.field === null ? (
            <p className="bank-payment-error bank-payment-offer-status">
              {t(editError.key)}
            </p>
          ) : null}
        </div>

        <button
          type="button"
          className="btn-wide bank-payment-edit-confirm"
          disabled={!activePayment}
          onClick={confirmEdits}
        >
          {t("spdPaymentEditConfirm")}
        </button>
      </section>
    );
  }

  return (
    <section className="panel panel-plain bank-payment-page">
      <div className="bank-payment-summary">
        <BankPaymentAmount
          canCycle={Boolean(amountText)}
          text={amountText || t("spdPaymentAmountUnknown")}
        />
      </div>

      <div className="bank-payment-fields">
        {rows.map((row) => (
          <div className="settings-row bank-payment-row" key={row.key}>
            <div>
              <strong>{row.label}</strong>
              <span className="bank-payment-value">{row.value}</span>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        className="btn-wide bank-payment-request"
        disabled={
          !activePayment ||
          selectedOfferContacts.length === 0 ||
          !amountText ||
          !hasEnoughCashuForProxy ||
          isRequestingOffer
        }
        title={!hasEnoughCashuForProxy ? t("payInsufficient") : undefined}
        onClick={() => {
          void requestReimbursement();
        }}
      >
        {isRequestingOffer
          ? t("spdPaymentOfferSending")
          : requestReimbursementLabel}
      </button>

      <div className="bank-payment-offer-delay">
        <span className="bank-payment-offer-delay-label">
          {t("bankPaymentOfferStaggerDelay")}
        </span>
        <SettingsStepper
          ariaLabel={t("bankPaymentOfferStaggerDelay")}
          decreaseLabel={t("bankPaymentOfferStaggerDelayDecrease")}
          increaseLabel={t("bankPaymentOfferStaggerDelayIncrease")}
          max={LINKY_BANK_PAYMENT_OFFER_MAX_STAGGER_DELAY_SEC}
          min={LINKY_BANK_PAYMENT_OFFER_MIN_STAGGER_DELAY_SEC}
          onChange={(value) => setOfferDelaySec(clampOfferDelaySec(value))}
          step={LINKY_BANK_PAYMENT_OFFER_STAGGER_DELAY_STEP_SEC}
          value={offerDelaySec}
          valueText={`${offerDelaySec} s`}
        />
      </div>

      {offerContacts.length > 0 ? (
        <div className="bank-payment-offer-contact-list">
          {offerContacts.map((contact) => {
            const key = getOfferContactKey(contact);
            const lastBankPaymentResponseSec =
              typeof contact.lastBankPaymentResponseSec === "number" &&
              Number.isFinite(contact.lastBankPaymentResponseSec) &&
              contact.lastBankPaymentResponseSec >= 0
                ? contact.lastBankPaymentResponseSec
                : null;
            const name = (contact.name ?? "").trim();
            const npub = (contact.npub ?? "").trim();
            const pictureUrl = (contact.pictureUrl ?? "").trim();
            const orderIndex = selectedOfferContactKeys.indexOf(key);
            const isSelected = orderIndex !== -1;

            return (
              <button
                type="button"
                className={
                  isSelected
                    ? "bank-payment-offer-contact is-selected"
                    : "bank-payment-offer-contact"
                }
                key={key}
                aria-label={name || npub || t("contact")}
                aria-pressed={isSelected}
                onClick={() => {
                  setHasEditedOfferContacts(true);
                  setSelectedOfferContactKeys((current) =>
                    // A re-added contact joins the end of the queue.
                    current.includes(key)
                      ? current.filter((candidate) => candidate !== key)
                      : [...current, key],
                  );
                }}
              >
                {/* The badge lives outside .contact-avatar, whose
                    overflow:hidden would clip it. */}
                <span
                  className="bank-payment-offer-contact-avatar"
                  aria-hidden="true"
                >
                  <span className="contact-avatar">
                    <Avatar
                      pictureUrl={pictureUrl}
                      fallback={getInitials(name)}
                      fallbackClassName="contact-avatar-fallback"
                      loading="lazy"
                    />
                  </span>
                  {isSelected ? (
                    <span className="bank-payment-offer-contact-order">
                      {orderIndex + 1}
                    </span>
                  ) : null}
                </span>
                <span className="contact-name">{name || t("contact")}</span>
                {lastBankPaymentResponseSec !== null ? (
                  <span className="bank-payment-offer-contact-response">
                    {t("spdPaymentLastResponseTime").replace(
                      "{time}",
                      formatResponseDuration(lastBankPaymentResponseSec),
                    )}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {offerStatus ? (
        <p className="muted bank-payment-offer-status">{offerStatus}</p>
      ) : null}
    </section>
  );
};
