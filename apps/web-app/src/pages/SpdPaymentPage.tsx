import {
  Avatar,
  Button,
  Notice,
  OptionTile,
  Row,
  SelectField,
  Stack,
  StatusDot,
  Stepper,
  Text,
  TextField,
  ListRow,
} from "@linky-fit/ui";
import type { ContactRowLike } from "../app/types/appTypes";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { canLockAcrossTabs } from "../utils/storage";
import { useFiatRates } from "../app/hooks/useFiatRates";
import {
  BANK_PAYMENT_OFFER_MAX_STAGGER_DELAY_SEC,
  BANK_PAYMENT_OFFER_MIN_STAGGER_DELAY_SEC,
  BANK_PAYMENT_OFFER_CURRENCIES,
  BANK_PAYMENT_OFFER_STAGGER_DELAY_STEP_SEC,
  createBlankBankPayment,
  isBankPaymentOfferCurrency,
  type BankPayment,
  type BankPaymentFieldKey,
  type BankPaymentFormat,
  type BankPaymentOfferCurrency,
  type BankPaymentOfferOutcome,
  formatDomesticBankAccount,
  getBankPaymentEditableFieldKeys,
  tryParseBankPayment,
  updateBankPaymentFields,
} from "@linky-fit/proxy-payment";
import { DisplayAmount } from "../components/DisplayAmount";
import { BankPaymentScreen, InvalidOfferView } from "./BankPaymentOfferViews";
import { navigateTo } from "../hooks/useRouting";
import type { I18nKey, Translate } from "../i18n";
import type { FiatRates } from "../utils/displayAmounts";
import { formatInteger } from "../utils/formatting";

interface SpdPaymentPageProps {
  cashuBalanceAfterMelt: number;
  initialOfferContactCount: number;
  initialOfferDelaySec: number;
  isEditing: boolean;
  isManualEntry: boolean;
  offerContacts: readonly (ContactRowLike & {
    pictureUrl?: string | null;
    /** How my last offers to this contact went, oldest first. */
    recentBankPaymentOfferOutcomes?: readonly BankPaymentOfferOutcome[];
  })[];
  onRequestReimbursement: (args: {
    amountSat: number | null;
    amountText: string;
    contacts: ContactRowLike[];
    singleTabRiskAccepted: boolean;
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

// Bank QR formats carry the due date as YYYYMMDD; the date input speaks ISO.
const toDateInputValue = (value: string): string =>
  /^\d{8}$/.test(value)
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
    : "";

const fromDateInputValue = (value: string): string => value.replace(/-/g, "");

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
  if (!Number.isFinite(value)) return BANK_PAYMENT_OFFER_MIN_STAGGER_DELAY_SEC;
  return Math.min(
    BANK_PAYMENT_OFFER_MAX_STAGGER_DELAY_SEC,
    Math.max(BANK_PAYMENT_OFFER_MIN_STAGGER_DELAY_SEC, Math.trunc(value)),
  );
};

const OUTCOME_DOTS: Record<
  BankPaymentOfferOutcome,
  { label: I18nKey; tone: "accent" | "danger" | "neutral" }
> = {
  canceled: { label: "spdPaymentOutcomeCanceled", tone: "danger" },
  settled: { label: "spdPaymentOutcomeSettled", tone: "accent" },
  unaccepted: { label: "spdPaymentOutcomeUnaccepted", tone: "neutral" },
};

const getRateForCurrency = (
  currency: string,
  fiatRates: FiatRates,
): number | null => {
  switch (currency.toUpperCase()) {
    case "BRL":
      return fiatRates.brlPerBtc;
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
  CITY: "spdPaymentCity",
  DT: "spdPaymentDueDate",
  MSG: "spdPaymentMessage",
  RF: "spdPaymentReference",
  RN: "spdPaymentRecipient",
  "X-KS": "spdPaymentConstantSymbol",
  "X-SS": "spdPaymentSpecificSymbol",
  "X-VS": "spdPaymentVariableSymbol",
};

// A Pix payment is addressed by a key, not an account number.
const getFieldLabelKey = (
  format: BankPaymentFormat,
  key: BankPaymentFieldKey,
): I18nKey =>
  format === "pix" && key === "ACC"
    ? "spdPaymentPixKey"
    : FIELD_LABEL_KEYS[key];

const buildSpdRows = (
  payment: BankPayment,
  t: Translate,
): SpdPaymentFieldRow[] =>
  getBankPaymentEditableFieldKeys(payment.format).flatMap((key) => {
    const value = getDisplayedFieldValue(payment, key);
    return value
      ? [{ key, label: t(getFieldLabelKey(payment.format, key)), value }]
      : [];
  });

type BankPaymentFields = Record<string, string>;

// `confirmed` edits are what the offer is built from; `draft` holds the form
// while the user is editing and becomes `confirmed` on confirm.
interface BankPaymentEdits {
  confirmed: BankPaymentFields | null;
  draft: BankPaymentFields | null;
  payload: string;
}

// The currency is only editable for a manual entry; a scanned payment keeps
// its own value through the merge.
const createDraftFields = (payment: BankPayment): BankPaymentFields =>
  Object.fromEntries(
    ["CC", "AM", ...getBankPaymentEditableFieldKeys(payment.format)].map(
      (key) => [key, getDisplayedFieldValue(payment, key)],
    ),
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
  "bank-payment-invalid-city": { field: "CITY", key: "spdPaymentInvalidCity" },
  "bank-payment-invalid-message": {
    field: "MSG",
    key: "spdPaymentInvalidMessage",
  },
  "bank-payment-invalid-recipient": {
    field: "RN",
    key: "spdPaymentInvalidRecipient",
  },
  "bank-payment-invalid-reference": {
    field: "RF",
    key: "spdPaymentInvalidReference",
  },
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
  isManualEntry,
  offerContacts,
  onRequestReimbursement,
  spdPayload,
}) => {
  const { displayCurrency, displayUnit, formatDisplayedAmountText, lang, t } =
    useAppShellCore();
  const fiatRates = useFiatRates();
  const [isRequestingOffer, setIsRequestingOffer] = React.useState(false);
  const [offerStatus, setOfferStatus] = React.useState<string | null>(null);
  const [singleTabRiskAccepted, setSingleTabRiskAccepted] =
    React.useState(false);
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
  // A manual entry's currency picks its format (Pix for BRL), so it lives
  // outside the draft fields that are keyed by the blank payment it produces.
  const [manualCurrency, setManualCurrency] =
    React.useState<BankPaymentOfferCurrency>("CZK");
  const payment = React.useMemo(
    () =>
      isManualEntry
        ? createBlankBankPayment(manualCurrency)
        : tryParseBankPayment(spdPayload),
    [isManualEntry, manualCurrency, spdPayload],
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

  if (!payment) return <InvalidOfferView t={t} />;

  const activePayment = editedPayment.payment;
  const amount = activePayment
    ? parseSpdAmount(getSpdField(activePayment, "AM"))
    : null;
  const currencyCode = (
    draftFields?.["CC"] ?? getSpdField(activePayment ?? payment, "CC")
  ).toUpperCase();
  const currency = currencyCode.toLowerCase();
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
  // Untouched scanned values are always valid; an untouched manual form is
  // not, and nagging about an empty account before typing would be noise.
  const editError = activeEdits?.draft ? editedPayment.error : null;
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
  // Switching the currency swaps the blank payment; the typed values the new
  // format also has move over instead of starting the form again.
  const changeManualCurrency = (code: string) => {
    if (!isBankPaymentOfferCurrency(code) || code === manualCurrency) return;
    const next = createBlankBankPayment(code);
    const nextDraft = createDraftFields(next);
    setEdits((current) => {
      const carried = Object.entries(current?.draft ?? {}).filter(
        ([key, value]) => key !== "CC" && key in nextDraft && value,
      );
      // Nothing typed yet means no draft, so the empty form is not an error.
      return {
        confirmed: null,
        draft:
          carried.length === 0
            ? null
            : { ...nextDraft, ...Object.fromEntries(carried) },
        payload: next.payload,
      };
    });
    setManualCurrency(code);
  };
  const confirmEdits = () => {
    if (!activePayment) return;
    // A manual entry becomes a regular bank payment route, so the confirmed
    // payload is what the offer and the payer's bank app receive.
    if (isManualEntry) {
      navigateTo({ route: "bankPayment", spdPayload: activePayment.payload });
      return;
    }
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

  const needsSingleTabConsent = !singleTabRiskAccepted && !canLockAcrossTabs();

  const requestReimbursement = async () => {
    if (
      !activePayment ||
      selectedOfferContacts.length === 0 ||
      !amountText ||
      !hasEnoughCashuForProxy ||
      isRequestingOffer ||
      needsSingleTabConsent
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
        singleTabRiskAccepted,
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

  const summary = (
    <DisplayAmount
      amount={amountText || t("spdPaymentAmountUnknown")}
      cycles={Boolean(amountText)}
      testID="bank-payment-amount"
    />
  );

  if (draftFields) {
    return (
      <BankPaymentScreen>
        {summary}

        <Stack gap="$md">
          {isManualEntry ? (
            <SelectField
              label={t("spdPaymentCurrency")}
              value={currencyCode}
              options={BANK_PAYMENT_OFFER_CURRENCIES.map((code) => ({
                label: code,
                value: code,
              }))}
              onValueChange={changeManualCurrency}
            />
          ) : null}
          {["AM" as const, ...editableKeys].map((key) => {
            const isDate = key === "DT";
            const fieldError = editError?.field === key ? editError : null;
            return (
              <TextField
                key={key}
                id={`bank-payment-field-${key}`}
                label={t(getFieldLabelKey(payment.format, key))}
                {...(fieldError ? { error: t(fieldError.key) } : {})}
                inputMode={key === "AM" ? "decimal" : undefined}
                type={isDate ? "date" : undefined}
                value={
                  isDate
                    ? toDateInputValue(draftFields[key] ?? "")
                    : (draftFields[key] ?? "")
                }
                onChangeText={(value) =>
                  updateDraftField(
                    key,
                    isDate ? fromDateInputValue(value) : value,
                  )
                }
                trailing={key === "AM" ? currencyCode : undefined}
              />
            );
          })}
          {editError && editError.field === null ? (
            <Notice tone="danger" title={t(editError.key)} />
          ) : null}
        </Stack>

        <Button disabled={!activePayment} onPress={confirmEdits}>
          {t("spdPaymentEditConfirm")}
        </Button>
      </BankPaymentScreen>
    );
  }

  return (
    <BankPaymentScreen>
      {summary}

      <Stack gap="$xs">
        {rows.map((row) => (
          <ListRow
            key={row.key}
            testID="bank-payment-row"
            title={row.label}
            value={row.value}
          />
        ))}
      </Stack>

      {needsSingleTabConsent ? (
        <Notice
          tone="accent"
          icon="CircleAlert"
          title={t("spdPaymentSingleTabWarningTitle")}
          description={t("spdPaymentSingleTabWarningBody")}
          action={{
            label: t("spdPaymentSingleTabContinue"),
            onPress: () => setSingleTabRiskAccepted(true),
          }}
        />
      ) : (
        <Button
          testID="bank-payment-request"
          disabled={
            !activePayment ||
            selectedOfferContacts.length === 0 ||
            !amountText ||
            !hasEnoughCashuForProxy ||
            isRequestingOffer
          }
          loading={isRequestingOffer}
          tooltip={!hasEnoughCashuForProxy ? t("payInsufficient") : undefined}
          onPress={() => {
            void requestReimbursement();
          }}
        >
          {requestReimbursementLabel}
        </Button>
      )}

      <Row gap="$sm">
        <Text variant="caption" flex={1}>
          {t("bankPaymentOfferStaggerDelay")}
        </Text>
        <Stepper
          accessibilityLabel={t("bankPaymentOfferStaggerDelay")}
          decreaseLabel={t("bankPaymentOfferStaggerDelayDecrease")}
          increaseLabel={t("bankPaymentOfferStaggerDelayIncrease")}
          max={BANK_PAYMENT_OFFER_MAX_STAGGER_DELAY_SEC}
          min={BANK_PAYMENT_OFFER_MIN_STAGGER_DELAY_SEC}
          onValueChange={(value) => setOfferDelaySec(clampOfferDelaySec(value))}
          step={BANK_PAYMENT_OFFER_STAGGER_DELAY_STEP_SEC}
          value={offerDelaySec}
          valueText={`${offerDelaySec} s`}
        />
      </Row>

      {offerContacts.length > 0 ? (
        <Row gap="$xs" flexWrap="wrap" alignItems="stretch">
          {offerContacts.map((contact) => {
            const key = getOfferContactKey(contact);
            const orderIndex = selectedOfferContactKeys.indexOf(key);
            return (
              <OfferContactTile
                contact={contact}
                key={key}
                order={orderIndex === -1 ? null : orderIndex + 1}
                t={t}
                onToggle={() => {
                  setHasEditedOfferContacts(true);
                  setSelectedOfferContactKeys((current) =>
                    // A re-added contact joins the end of the queue.
                    current.includes(key)
                      ? current.filter((candidate) => candidate !== key)
                      : [...current, key],
                  );
                }}
              />
            );
          })}
        </Row>
      ) : null}

      {offerStatus ? <Notice tone="danger" title={offerStatus} /> : null}
    </BankPaymentScreen>
  );
};

interface OfferContactTileProps {
  contact: SpdPaymentPageProps["offerContacts"][number];
  /** Position in the send queue, or null when the contact is not selected. */
  order: number | null;
  onToggle: () => void;
  t: Translate;
}

const OfferContactTile = ({
  contact,
  order,
  onToggle,
  t,
}: OfferContactTileProps) => {
  const name = (contact.name ?? "").trim();
  const npub = (contact.npub ?? "").trim();
  const pictureUrl = (contact.pictureUrl ?? "").trim();
  const outcomes = contact.recentBankPaymentOfferOutcomes ?? [];
  const isSelected = order !== null;
  return (
    <OptionTile
      testID="bank-payment-offer-contact"
      aria-label={name || npub || t("contact")}
      label={name || t("contact")}
      selected={isSelected}
      onPress={onToggle}
      flex={1}
      minWidth="$hero"
      leading={
        // Side padding leaves room for the order badge to overhang the avatar.
        <Stack position="relative" paddingHorizontal="$sm" paddingBottom="$xs">
          <Avatar name={name} size="sm" uri={pictureUrl || undefined} />
          {isSelected ? (
            <Text
              testID="bank-payment-offer-contact-order"
              position="absolute"
              right="$none"
              bottom="$none"
              minWidth="$iconSm"
              paddingHorizontal="$xxs"
              borderRadius="$pill"
              overflow="hidden"
              backgroundColor="$accent"
              color="$onAccent"
              variant="caption"
              bold
              textAlign="center"
            >
              {order}
            </Text>
          ) : null}
        </Stack>
      }
    >
      {outcomes.length > 0 ? (
        <Row
          testID="bank-payment-offer-contact-outcomes"
          gap="$xs"
          justifyContent="center"
        >
          {outcomes.map((outcome, index) => (
            <StatusDot
              key={index}
              tone={OUTCOME_DOTS[outcome].tone}
              accessibilityLabel={t(OUTCOME_DOTS[outcome].label)}
            />
          ))}
        </Row>
      ) : null}
    </OptionTile>
  );
};
