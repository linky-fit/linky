import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useRecurringPaymentsContext } from "../app/context/RecurringPaymentsContext";
import { useRecurringContactSummaries } from "../app/hooks/payments/useRecurringPaymentOrders";
import {
  dateTimeLocalToEpoch,
  epochToDateTimeLocal,
  nextFullHourSec,
} from "../app/lib/recurringPaymentDisplay";
import type { RecurringPaymentRecipient } from "../app/lib/recurringPaymentOrder";
import {
  isRecurringIntervalUnit,
  isValidRecurringInterval,
  MAX_RECURRING_INTERVAL_COUNT,
  RECURRING_INTERVAL_UNITS,
  type RecurringIntervalUnit,
} from "../app/lib/recurringSchedule";
import { navigateTo } from "../hooks/useRouting";
import type { I18nKey } from "../i18n";
import { nowSeconds } from "../utils/time";

const UNIT_LABEL_KEYS: Record<RecurringIntervalUnit, I18nKey> = {
  hour: "recurringUnitHours",
  day: "recurringUnitDays",
  week: "recurringUnitWeeks",
  month: "recurringUnitMonths",
};

interface Prefill {
  amountSat: string;
  contactId: string;
  lnAddress: string;
}

// `#wallet/recurring/new?contact=…&ln=…&amount=…` from the pay pages.
const readPrefillFromHash = (): Prefill => {
  const query = (globalThis.location?.hash ?? "").split("?")[1] ?? "";
  const params = new URLSearchParams(query);
  const amount = Number.parseInt(params.get("amount") ?? "", 10);
  return {
    amountSat: Number.isFinite(amount) && amount > 0 ? String(amount) : "",
    contactId: params.get("contact")?.trim() ?? "",
    lnAddress: params.get("ln")?.trim() ?? "",
  };
};

const parsePositiveInt = (value: string): number | null => {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

export function RecurringPaymentNewPage(): React.ReactElement {
  const { t } = useAppShellCore();
  const { createRecurringPayment } = useRecurringPaymentsContext();
  const contacts = useRecurringContactSummaries();
  const [prefill] = React.useState(readPrefillFromHash);

  const [recipientKind, setRecipientKind] = React.useState<
    RecurringPaymentRecipient["kind"]
  >(prefill.lnAddress && !prefill.contactId ? "lnAddress" : "contact");
  const [contactId, setContactId] = React.useState(prefill.contactId);
  const [lnAddress, setLnAddress] = React.useState(prefill.lnAddress);
  const [title, setTitle] = React.useState("");
  const [amountText, setAmountText] = React.useState(prefill.amountSat);
  const [intervalCountText, setIntervalCountText] = React.useState("1");
  const [intervalUnit, setIntervalUnit] =
    React.useState<RecurringIntervalUnit>("month");
  const [firstRunText, setFirstRunText] = React.useState(() =>
    epochToDateTimeLocal(nextFullHourSec(nowSeconds())),
  );
  const [maxRunsText, setMaxRunsText] = React.useState("");
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const payableContacts = React.useMemo(
    () =>
      Array.from(contacts.values())
        .filter((contact) => contact.npub !== null)
        .sort((a, b) =>
          (a.name ?? a.npub ?? "").localeCompare(b.name ?? b.npub ?? ""),
        ),
    [contacts],
  );

  const selectedContact = contactId ? contacts.get(contactId) : undefined;
  const titlePlaceholder =
    recipientKind === "contact"
      ? (selectedContact?.name ?? selectedContact?.lnAddress ?? "")
      : lnAddress.trim();

  const submit = (): void => {
    const trimmedTitle = title.trim() || titlePlaceholder;
    const amountSat = parsePositiveInt(amountText);
    const intervalCount = parsePositiveInt(intervalCountText);
    const firstDueAtSec = dateTimeLocalToEpoch(firstRunText);
    const maxRuns = maxRunsText.trim() ? parsePositiveInt(maxRunsText) : null;
    const recipient: RecurringPaymentRecipient | null =
      recipientKind === "contact"
        ? contactId && contacts.has(contactId)
          ? { kind: "contact", contactId }
          : null
        : lnAddress.trim()
          ? { kind: "lnAddress", lnAddress: lnAddress.trim() }
          : null;
    const interval =
      intervalCount === null
        ? null
        : { unit: intervalUnit, count: intervalCount };
    if (
      !trimmedTitle ||
      recipient === null ||
      amountSat === null ||
      interval === null ||
      !isValidRecurringInterval(interval) ||
      firstDueAtSec === null ||
      (maxRunsText.trim() !== "" && maxRuns === null)
    ) {
      setError(t("recurringInvalidForm"));
      return;
    }
    const created = createRecurringPayment({
      amountSat,
      endAtSec: null,
      firstDueAtSec,
      interval,
      maxRuns,
      note: note.trim() || null,
      recipient,
      title: trimmedTitle,
    });
    if (!created) {
      setError(t("recurringInvalidForm"));
      return;
    }
    navigateTo({ route: "recurringPayments" });
  };

  return (
    <section className="panel recurring-form">
      <label htmlFor="recurringRecipientKind">
        {t("recurringRecipientLabel")}
      </label>
      <select
        id="recurringRecipientKind"
        className="select recurring-select-wide"
        value={recipientKind}
        onChange={(event) =>
          setRecipientKind(
            event.target.value === "lnAddress" ? "lnAddress" : "contact",
          )
        }
      >
        <option value="contact">{t("contact")}</option>
        <option value="lnAddress">{t("lightningAddress")}</option>
      </select>

      {recipientKind === "contact" ? (
        <select
          id="recurringContact"
          className="select recurring-select-wide"
          value={contactId}
          onChange={(event) => setContactId(event.target.value)}
        >
          <option value="">{t("recurringSelectContact")}</option>
          {payableContacts.map((contact) => (
            <option key={contact.id} value={contact.id}>
              {contact.name ?? contact.lnAddress ?? contact.npub}
            </option>
          ))}
        </select>
      ) : (
        <input
          id="recurringLnAddress"
          value={lnAddress}
          onChange={(event) => setLnAddress(event.target.value)}
          placeholder={t("lightningAddressPlaceholder")}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode="email"
        />
      )}

      <label htmlFor="recurringTitle">{t("recurringTitleLabel")}</label>
      <input
        id="recurringTitle"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder={titlePlaceholder}
        maxLength={200}
      />

      <label htmlFor="recurringAmount">{t("recurringAmountLabel")}</label>
      <input
        id="recurringAmount"
        value={amountText}
        onChange={(event) => setAmountText(event.target.value)}
        inputMode="numeric"
        pattern="[0-9]*"
        placeholder="1000"
      />

      <label htmlFor="recurringIntervalCount">
        {t("recurringIntervalLabel")}
      </label>
      <div className="recurring-interval-row">
        <span className="muted">{t("recurringEveryPrefix")}</span>
        <input
          id="recurringIntervalCount"
          className="recurring-interval-count"
          value={intervalCountText}
          onChange={(event) => setIntervalCountText(event.target.value)}
          inputMode="numeric"
          pattern="[0-9]*"
          min={1}
          max={MAX_RECURRING_INTERVAL_COUNT}
        />
        <select
          id="recurringIntervalUnit"
          className="select"
          value={intervalUnit}
          onChange={(event) => {
            if (isRecurringIntervalUnit(event.target.value)) {
              setIntervalUnit(event.target.value);
            }
          }}
        >
          {RECURRING_INTERVAL_UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {t(UNIT_LABEL_KEYS[unit])}
            </option>
          ))}
        </select>
      </div>

      <label htmlFor="recurringFirstRun">{t("recurringFirstRunLabel")}</label>
      <input
        id="recurringFirstRun"
        type="datetime-local"
        value={firstRunText}
        onChange={(event) => setFirstRunText(event.target.value)}
      />

      <label htmlFor="recurringMaxRuns">{t("recurringMaxRunsLabel")}</label>
      <input
        id="recurringMaxRuns"
        value={maxRunsText}
        onChange={(event) => setMaxRunsText(event.target.value)}
        inputMode="numeric"
        pattern="[0-9]*"
        placeholder="∞"
      />

      <label htmlFor="recurringNote">{t("recurringNoteLabel")}</label>
      <input
        id="recurringNote"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={500}
      />

      <p className="muted">{t("recurringOnlyWhileOpen")}</p>
      {error ? <p className="error-text">{error}</p> : null}

      <div className="actions">
        <button type="button" className="btn-wide" onClick={submit}>
          {t("recurringSave")}
        </button>
      </div>
    </section>
  );
}
