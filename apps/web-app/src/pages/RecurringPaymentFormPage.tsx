import type { RecurringPaymentId } from "@linky/linksync";
import {
  currentTimeZone,
  isFiatRecurringAmount,
  recurringAmountSat,
  recurringDueAt,
  recurringFiatValue,
  type RecurringInterval,
  type RecurringIntervalUnit,
  type RecurringPaymentOrder,
} from "@linky/recurring-payment";
import { Repeat } from "lucide-react";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useRecurringPaymentsContext } from "../app/context/RecurringPaymentsContext";
import {
  contactSummaryLabel,
  isPayableContact,
  useRecurringContactSummaries,
  useRecurringPaymentOrders,
  type RecurringContactSummary,
} from "../app/hooks/payments/useRecurringPaymentOrders";
import { recurringAmountFromInput } from "../app/lib/recurringAmount";
import {
  dateTimeLocalToEpoch,
  epochToDateTimeLocal,
  nextFullHourSec,
} from "../app/lib/recurringPaymentDisplay";
import { AmountDisplay } from "../components/AmountDisplay";
import { Keypad } from "../components/Keypad";
import { RecurringContactAvatar } from "../components/RecurringContactAvatar";
import { useAmountInputKeypad } from "../components/useAmountInputKeypad";
import { navigateTo } from "../hooks/useRouting";
import type { I18nKey } from "../i18n";
import { normalizeLocale } from "../utils/formatting";
import { nowSeconds } from "../utils/time";

type Frequency = Extract<RecurringIntervalUnit, "day" | "week" | "month">;

const FREQUENCIES: ReadonlyArray<{ key: Frequency; label: I18nKey }> = [
  { key: "day", label: "recurringPresetDaily" },
  { key: "week", label: "recurringPresetWeekly" },
  { key: "month", label: "recurringPresetMonthly" },
];

const isFrequency = (unit: RecurringIntervalUnit): unit is Frequency =>
  unit === "day" || unit === "week" || unit === "month";

interface FormInitial {
  /** Sat amount for the keypad; empty for a fresh form. */
  amountSat: string;
  /** Exact fiat text for the keypad when the payment is fixed in the display currency. */
  amountDisplayValue: string | null;
  contactId: string;
  firstRunSec: number | null;
  frequency: Frequency;
  /** Set when the form was opened from a completed payment. */
  repeatsPayment: boolean;
}

// `#wallet/recurring/new?contact=…&amount=…` from a contact page or a
// completed payment.
const readPrefillFromHash = (): FormInitial => {
  const query = (globalThis.location?.hash ?? "").split("?")[1] ?? "";
  const params = new URLSearchParams(query);
  const amount = Number.parseInt(params.get("amount") ?? "", 10);
  const contactId = params.get("contact")?.trim() ?? "";
  return {
    amountSat: Number.isFinite(amount) && amount > 0 ? String(amount) : "",
    amountDisplayValue: null,
    contactId,
    firstRunSec: null,
    frequency: "month",
    repeatsPayment: Boolean(contactId) && amount > 0,
  };
};

const pill = (active: boolean): string =>
  active
    ? "group-filter-btn contact-group-pill is-active"
    : "group-filter-btn contact-group-pill";

interface RecurringPaymentFormPageProps {
  editId?: RecurringPaymentId;
}

/** New payment, or an existing one when `editId` is set (same fields, saved in place). */
export function RecurringPaymentFormPage({
  editId,
}: RecurringPaymentFormPageProps): React.ReactElement {
  const { displayCurrency, fiatRates, t } = useAppShellCore();
  const orders = useRecurringPaymentOrders();
  const order = editId
    ? (orders.find((candidate) => candidate.id === editId) ?? null)
    : null;
  const initial = React.useMemo((): FormInitial | null => {
    if (!editId) return readPrefillFromHash();
    if (order === null) return null;
    const amountSat = recurringAmountSat(order.amount, fiatRates);
    return {
      amountSat: amountSat === null ? "" : String(amountSat),
      amountDisplayValue:
        isFiatRecurringAmount(order.amount) &&
        order.amount.unit === displayCurrency
          ? String(recurringFiatValue(order.amount))
          : null,
      contactId: order.contactId,
      firstRunSec: order.schedule.nextDueAtSec,
      frequency: isFrequency(order.schedule.interval.unit)
        ? order.schedule.interval.unit
        : "month",
      repeatsPayment: false,
    };
    // The form takes its initial values once; later rate or order changes
    // must not reset what the user is typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId, order === null]);

  if (initial === null) {
    return (
      <section className="panel panel-plain">
        <p className="muted">
          {orders.length === 0 ? "" : t("recurringNotFound")}
        </p>
      </section>
    );
  }
  return (
    <RecurringPaymentForm
      key={editId ?? "new"}
      initial={initial}
      order={order}
    />
  );
}

interface RecurringPaymentFormProps {
  initial: FormInitial;
  order: RecurringPaymentOrder | null;
}

function RecurringPaymentForm({
  initial,
  order,
}: RecurringPaymentFormProps): React.ReactElement {
  const { cashuIsBusy, displayCurrency, displayUnit, fiatRates, lang, t } =
    useAppShellCore();
  const { createRecurringPayment, updateRecurringPayment } =
    useRecurringPaymentsContext();
  const contacts = useRecurringContactSummaries();

  const [contactId, setContactId] = React.useState(initial.contactId);
  const [search, setSearch] = React.useState("");
  const [amount, setAmount] = React.useState(initial.amountSat);
  const [frequency, setFrequency] = React.useState<Frequency>(
    initial.frequency,
  );
  const [firstRunText, setFirstRunText] = React.useState<string | null>(
    initial.firstRunSec === null
      ? null
      : epochToDateTimeLocal(initial.firstRunSec),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);
  const amountInput = useAmountInputKeypad({
    amount,
    initialDisplayValue: initial.amountDisplayValue,
    onAmountChange: setAmount,
  });

  const contact = contactId ? contacts.get(contactId) : undefined;
  const interval: RecurringInterval = { unit: frequency, count: 1 };
  const timeZone = currentTimeZone();

  // Repeating a finished payment starts one period later; a fresh one at the
  // next full hour. Either way the user can move it.
  const defaultFirstRunSec = React.useMemo(() => {
    const now = nowSeconds();
    return initial.repeatsPayment
      ? recurringDueAt(now, interval, 1, timeZone)
      : nextFullHourSec(now);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frequency, initial.repeatsPayment]);
  const firstRunSec =
    firstRunText === null
      ? defaultFirstRunSec
      : dateTimeLocalToEpoch(firstRunText);
  // The picker has minute precision, so the current minute still counts.
  const earliestFirstRunSec = Math.floor(nowSeconds() / 60) * 60;
  const firstRunInPast =
    firstRunSec !== null && firstRunSec < earliestFirstRunSec;
  const secondRunSec =
    firstRunSec === null
      ? null
      : recurringDueAt(firstRunSec, interval, 1, timeZone);

  const dateFormatter = React.useMemo(
    () =>
      new Intl.DateTimeFormat(normalizeLocale(lang), {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }),
    [lang],
  );
  const formatDate = (epochSec: number) =>
    dateFormatter.format(new Date(epochSec * 1000));

  const payableContacts = React.useMemo(() => {
    const query = search.trim().toLowerCase();
    return Array.from(contacts.values())
      .filter(isPayableContact)
      .filter(
        (candidate) =>
          !query ||
          [candidate.name, candidate.lnAddress, candidate.npub].some((value) =>
            value?.toLowerCase().includes(query),
          ),
      )
      .sort((a, b) =>
        contactSummaryLabel(a).localeCompare(contactSummaryLabel(b)),
      );
  }, [contacts, search]);

  if (!contact) {
    return (
      <ContactPicker
        contacts={payableContacts}
        onPick={(picked) => setContactId(picked.id)}
        onSearch={setSearch}
        search={search}
      />
    );
  }

  const recurringAmount = recurringAmountFromInput({
    amountSat: amount,
    displayCurrency,
    displayValue: amountInput.inputDisplayValue,
    fiatRates,
  });
  const canSave =
    recurringAmount !== null &&
    firstRunSec !== null &&
    !firstRunInPast &&
    !cashuIsBusy;

  const submit = async (): Promise<void> => {
    if (recurringAmount === null || firstRunSec === null) {
      setError(t("recurringInvalidForm"));
      return;
    }
    if (firstRunInPast) {
      setError(t("recurringFirstRunInPast"));
      return;
    }
    const input = {
      amount: recurringAmount,
      contactId: contact.id,
      firstDueAtSec: firstRunSec,
      interval,
    };
    setIsSaving(true);
    try {
      const saved = order
        ? await updateRecurringPayment(order, input)
        : await createRecurringPayment(input);
      if (!saved) {
        setError(t("recurringInvalidForm"));
        return;
      }
    } finally {
      setIsSaving(false);
    }
    if (order) navigateTo({ route: "recurringPayment", id: order.id });
    else navigateTo({ route: "transactions" });
  };

  return (
    <section className="panel panel-plain recurring-form">
      <div className="contact-header recurring-recipient-header">
        <RecurringContactAvatar
          className="contact-avatar is-large"
          contact={contact}
        />
        <div className="contact-header-text">
          <h3 className="unspaced recurring-truncate">
            {contactSummaryLabel(contact)}
          </h3>
          <button
            type="button"
            className="wallet-subtle-link recurring-inline-link"
            onClick={() => setContactId("")}
          >
            {t("recurringChangeRecipient")}
          </button>
        </div>
      </div>

      <AmountDisplay
        amount={amount}
        cycleOnClick
        inputDisplayValue={amountInput.inputDisplayValue}
      />
      <Keypad
        ariaLabel={`${t("payAmount")} (${displayUnit})`}
        decimalKeyEnabled={amountInput.decimalKeyEnabled}
        disabled={false}
        onKeyPress={(key: string) => amountInput.onKeyPress(key)}
        translations={{
          clearForm: t("clearForm"),
          decimalPoint: t("decimalPoint"),
          delete: t("delete"),
        }}
      />

      <label>{t("recurringFrequencyLabel")}</label>
      <div className="contact-group-selector recurring-pills" role="radiogroup">
        {FREQUENCIES.map((option) => (
          <button
            key={option.key}
            type="button"
            className={pill(frequency === option.key)}
            aria-pressed={frequency === option.key}
            onClick={() => setFrequency(option.key)}
          >
            {t(option.label)}
          </button>
        ))}
      </div>

      <label htmlFor="recurringFirstRun">
        {order ? t("recurringNextRun") : t("recurringFirstRunLabel")}
      </label>
      <input
        id="recurringFirstRun"
        type="datetime-local"
        min={epochToDateTimeLocal(earliestFirstRunSec)}
        value={firstRunText ?? epochToDateTimeLocal(defaultFirstRunSec)}
        onChange={(event) => setFirstRunText(event.target.value)}
      />
      <p
        className={
          firstRunInPast
            ? "error-text recurring-summary"
            : "muted recurring-summary"
        }
      >
        <Repeat size={14} aria-hidden="true" />
        <span>
          {firstRunInPast
            ? t("recurringFirstRunInPast")
            : secondRunSec === null
              ? t("recurringInvalidForm")
              : t("recurringSummaryNext").replace(
                  "{date}",
                  formatDate(secondRunSec),
                )}
        </span>
      </p>

      {error ? <p className="error-text">{error}</p> : null}
      <p className="muted recurring-hint">{t("recurringOnlyWhileOpen")}</p>

      <div className="actions">
        <button
          type="button"
          className="btn-wide"
          onClick={() => void submit()}
          disabled={!canSave || isSaving}
        >
          <span className="btn-label-with-icon">
            <span className="btn-label-icon" aria-hidden="true">
              <Repeat size={18} />
            </span>
            <span>
              {order ? t("recurringSaveChanges") : t("recurringSave")}
            </span>
          </span>
        </button>
      </div>
    </section>
  );
}

interface ContactPickerProps {
  contacts: ReadonlyArray<RecurringContactSummary>;
  onPick: (contact: RecurringContactSummary) => void;
  onSearch: (value: string) => void;
  search: string;
}

function ContactPicker({
  contacts,
  onPick,
  onSearch,
  search,
}: ContactPickerProps): React.ReactElement {
  const { t } = useAppShellCore();
  return (
    <section className="panel panel-plain recurring-picker">
      <label htmlFor="recurringSearch">{t("recurringChooseContact")}</label>
      <input
        id="recurringSearch"
        value={search}
        onChange={(event) => onSearch(event.target.value)}
        placeholder={t("recurringSearchContacts")}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      {contacts.length === 0 ? (
        <p className="muted recurring-hint">
          {t("recurringNoPayableContacts")}
        </p>
      ) : (
        <div className="transactions-list recurring-picker-list">
          {contacts.map((candidate) => (
            <button
              type="button"
              key={candidate.id}
              className="transaction-card recurring-order-card"
              onClick={() => onPick(candidate)}
            >
              <article className="transaction-row">
                <RecurringContactAvatar
                  className="contact-avatar transaction-avatar"
                  contact={candidate}
                />
                <div className="transaction-main">
                  <div className="transaction-title">
                    {contactSummaryLabel(candidate)}
                  </div>
                  {candidate.name && candidate.lnAddress ? (
                    <div className="transaction-meta recurring-truncate">
                      {candidate.lnAddress}
                    </div>
                  ) : null}
                </div>
              </article>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
