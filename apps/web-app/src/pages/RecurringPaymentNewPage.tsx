import { Minus, Plus, Repeat } from "lucide-react";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useRecurringPaymentsContext } from "../app/context/RecurringPaymentsContext";
import {
  contactSummaryLabel,
  isPayableContact,
  useRecurringContactSummaries,
} from "../app/hooks/payments/useRecurringPaymentOrders";
import {
  dateTimeLocalToEpoch,
  describeRecurringInterval,
  epochToDateTimeLocal,
  nextFullHourSec,
} from "../app/lib/recurringPaymentDisplay";
import {
  currentTimeZone,
  isValidRecurringInterval,
  MAX_RECURRING_INTERVAL_COUNT,
  RECURRING_INTERVAL_UNITS,
  recurringDueAt,
  type RecurringInterval,
  type RecurringIntervalUnit,
} from "../app/lib/recurringSchedule";
import { AmountDisplay } from "../components/AmountDisplay";
import { Keypad } from "../components/Keypad";
import { RecurringContactAvatar } from "../components/RecurringContactAvatar";
import { useAmountInputKeypad } from "../components/useAmountInputKeypad";
import { navigateTo } from "../hooks/useRouting";
import type { I18nKey } from "../i18n";
import { normalizeLocale } from "../utils/formatting";
import { nowSeconds } from "../utils/time";

type Frequency = "day" | "week" | "month" | "custom";

const FREQUENCIES: ReadonlyArray<{ key: Frequency; label: I18nKey }> = [
  { key: "day", label: "recurringPresetDaily" },
  { key: "week", label: "recurringPresetWeekly" },
  { key: "month", label: "recurringPresetMonthly" },
  { key: "custom", label: "recurringPresetCustom" },
];

const UNIT_LABEL_KEYS: Record<RecurringIntervalUnit, I18nKey> = {
  hour: "recurringUnitHours",
  day: "recurringUnitDays",
  week: "recurringUnitWeeks",
  month: "recurringUnitMonths",
};

const DEFAULT_MAX_RUNS = 12;

interface Prefill {
  amountSat: string;
  contactId: string;
}

// `#wallet/recurring/new?contact=…&amount=…` from a completed payment.
const readPrefillFromHash = (): Prefill => {
  const query = (globalThis.location?.hash ?? "").split("?")[1] ?? "";
  const params = new URLSearchParams(query);
  const amount = Number.parseInt(params.get("amount") ?? "", 10);
  return {
    amountSat: Number.isFinite(amount) && amount > 0 ? String(amount) : "",
    contactId: params.get("contact")?.trim() ?? "",
  };
};

const pill = (active: boolean): string =>
  active
    ? "group-filter-btn contact-group-pill is-active"
    : "group-filter-btn contact-group-pill";

export function RecurringPaymentNewPage(): React.ReactElement {
  const { cashuIsBusy, displayUnit, lang, t } = useAppShellCore();
  const { createRecurringPayment } = useRecurringPaymentsContext();
  const contacts = useRecurringContactSummaries();
  const [prefill] = React.useState(readPrefillFromHash);

  const [contactId, setContactId] = React.useState(prefill.contactId);
  const [search, setSearch] = React.useState("");
  const [amount, setAmount] = React.useState(prefill.amountSat);
  const [frequency, setFrequency] = React.useState<Frequency>("month");
  const [customCount, setCustomCount] = React.useState("2");
  const [customUnit, setCustomUnit] =
    React.useState<RecurringIntervalUnit>("week");
  const [showMore, setShowMore] = React.useState(false);
  const [firstRunText, setFirstRunText] = React.useState<string | null>(null);
  const [maxRuns, setMaxRuns] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const amountInput = useAmountInputKeypad({
    amount,
    onAmountChange: setAmount,
  });

  const contact = contactId ? contacts.get(contactId) : undefined;
  const interval = React.useMemo((): RecurringInterval | null => {
    if (frequency !== "custom") return { unit: frequency, count: 1 };
    const count = Number.parseInt(customCount, 10);
    return Number.isInteger(count) && count > 0
      ? { unit: customUnit, count }
      : null;
  }, [customCount, customUnit, frequency]);
  const intervalValid = interval !== null && isValidRecurringInterval(interval);

  // Repeating a finished payment starts one period later; a fresh one starts
  // at the next full hour. Either way the user can move it.
  const defaultFirstRunSec = React.useMemo(() => {
    const now = nowSeconds();
    if (prefill.contactId && interval !== null && intervalValid) {
      return recurringDueAt(now, interval, 1, currentTimeZone());
    }
    return nextFullHourSec(now);
  }, [interval, intervalValid, prefill.contactId]);
  const firstRunSec =
    firstRunText === null
      ? defaultFirstRunSec
      : dateTimeLocalToEpoch(firstRunText);

  const dateFormatter = React.useMemo(
    () =>
      new Intl.DateTimeFormat(normalizeLocale(lang), {
        day: "numeric",
        month: "numeric",
        year: "numeric",
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
      <section className="panel panel-plain recurring-picker">
        <label htmlFor="recurringSearch">{t("recurringChooseContact")}</label>
        <input
          id="recurringSearch"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("recurringSearchContacts")}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        {payableContacts.length === 0 ? (
          <p className="muted recurring-hint">
            {t("recurringNoPayableContacts")}
          </p>
        ) : (
          <div className="transactions-list recurring-picker-list">
            {payableContacts.map((candidate) => (
              <button
                type="button"
                key={candidate.id}
                className="transaction-card recurring-order-card"
                onClick={() => setContactId(candidate.id)}
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

  const amountSat = Number.parseInt(amount.trim(), 10);
  const amountValid = Number.isFinite(amountSat) && amountSat > 0;
  const lastRunSec =
    maxRuns !== null && interval !== null && firstRunSec !== null
      ? recurringDueAt(firstRunSec, interval, maxRuns - 1, currentTimeZone())
      : null;

  const submit = (): void => {
    if (
      !amountValid ||
      interval === null ||
      !intervalValid ||
      firstRunSec === null
    ) {
      setError(t("recurringInvalidForm"));
      return;
    }
    const created = createRecurringPayment({
      amountSat,
      contactId: contact.id,
      firstDueAtSec: firstRunSec,
      interval,
      maxRuns,
    });
    if (!created) {
      setError(t("recurringInvalidForm"));
      return;
    }
    navigateTo({ route: "transactions" });
  };

  return (
    <section className="panel recurring-form">
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
      {frequency === "custom" ? (
        <>
          <div className="recurring-interval-row">
            <span className="muted">{t("recurringEveryPrefix")}</span>
            <input
              id="recurringIntervalCount"
              className="recurring-interval-count"
              value={customCount}
              onChange={(event) => setCustomCount(event.target.value)}
              inputMode="numeric"
              pattern="[0-9]*"
              min={1}
              max={MAX_RECURRING_INTERVAL_COUNT}
            />
          </div>
          <div
            className="contact-group-selector recurring-pills"
            role="radiogroup"
          >
            {RECURRING_INTERVAL_UNITS.map((unit) => (
              <button
                key={unit}
                type="button"
                className={pill(customUnit === unit)}
                aria-pressed={customUnit === unit}
                onClick={() => setCustomUnit(unit)}
              >
                {t(UNIT_LABEL_KEYS[unit])}
              </button>
            ))}
          </div>
        </>
      ) : null}

      <p className="muted recurring-summary">
        <Repeat size={14} aria-hidden="true" />
        <span>
          {[
            interval !== null && intervalValid
              ? describeRecurringInterval(interval, t)
              : null,
            firstRunSec !== null
              ? t("recurringSummaryFirst").replace(
                  "{date}",
                  formatDate(firstRunSec),
                )
              : null,
            lastRunSec !== null
              ? t("recurringSummaryLast").replace(
                  "{date}",
                  formatDate(lastRunSec),
                )
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </p>

      <button
        type="button"
        className="wallet-subtle-link recurring-inline-link"
        aria-expanded={showMore}
        onClick={() => setShowMore((value) => !value)}
      >
        {t("recurringMoreOptions")}
      </button>
      {showMore ? (
        <div className="recurring-more">
          <label htmlFor="recurringFirstRun">
            {t("recurringFirstRunLabel")}
          </label>
          <input
            id="recurringFirstRun"
            type="datetime-local"
            value={firstRunText ?? epochToDateTimeLocal(defaultFirstRunSec)}
            onChange={(event) => setFirstRunText(event.target.value)}
          />

          <label>{t("recurringEndLabel")}</label>
          <div
            className="contact-group-selector recurring-pills"
            role="radiogroup"
          >
            <button
              type="button"
              className={pill(maxRuns === null)}
              aria-pressed={maxRuns === null}
              onClick={() => setMaxRuns(null)}
            >
              {t("recurringEndForever")}
            </button>
            <button
              type="button"
              className={pill(maxRuns !== null)}
              aria-pressed={maxRuns !== null}
              onClick={() => setMaxRuns((value) => value ?? DEFAULT_MAX_RUNS)}
            >
              {t("recurringEndLimited")}
            </button>
          </div>
          {maxRuns !== null ? (
            <div className="recurring-stepper">
              <button
                type="button"
                className="secondary"
                aria-label={t("recurringDecrease")}
                disabled={maxRuns <= 1}
                onClick={() =>
                  setMaxRuns((value) => Math.max(1, (value ?? 1) - 1))
                }
              >
                <Minus size={18} aria-hidden="true" />
              </button>
              <span className="recurring-stepper-value" aria-live="polite">
                {maxRuns}×
              </span>
              <button
                type="button"
                className="secondary"
                aria-label={t("recurringIncrease")}
                disabled={maxRuns >= MAX_RECURRING_INTERVAL_COUNT}
                onClick={() => setMaxRuns((value) => (value ?? 0) + 1)}
              >
                <Plus size={18} aria-hidden="true" />
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="error-text">{error}</p> : null}
      <p className="muted recurring-hint">{t("recurringOnlyWhileOpen")}</p>

      <div className="actions">
        <button
          type="button"
          className="btn-wide"
          onClick={submit}
          disabled={cashuIsBusy || !amountValid || !intervalValid}
        >
          <span className="btn-label-with-icon">
            <span className="btn-label-icon" aria-hidden="true">
              <Repeat size={18} />
            </span>
            <span>{t("recurringSave")}</span>
          </span>
        </button>
      </div>
    </section>
  );
}
