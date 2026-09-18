import { Repeat } from "lucide-react";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useRecurringPaymentsContext } from "../app/context/RecurringPaymentsContext";
import {
  useRecurringContactSummaries,
  type RecurringContactSummary,
} from "../app/hooks/payments/useRecurringPaymentOrders";
import {
  dateTimeLocalToEpoch,
  describeRecurringInterval,
  epochToDateTimeLocal,
  nextFullHourSec,
} from "../app/lib/recurringPaymentDisplay";
import type { RecurringPaymentRecipient } from "../app/lib/recurringPaymentOrder";
import {
  isValidRecurringInterval,
  MAX_RECURRING_INTERVAL_COUNT,
  RECURRING_INTERVAL_UNITS,
  type RecurringIntervalUnit,
} from "../app/lib/recurringSchedule";
import { Avatar } from "../components/Avatar";
import { deriveDefaultProfile } from "../derivedProfile";
import { navigateTo } from "../hooks/useRouting";
import type { I18nKey } from "../i18n";
import { getInitials } from "../utils/formatting";
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

const contactLabel = (contact: RecurringContactSummary): string =>
  contact.name ?? contact.lnAddress ?? contact.npub ?? "";

export function RecurringPaymentNewPage(): React.ReactElement {
  const { nostrPictureByNpub, t } = useAppShellCore();
  const { createRecurringPayment } = useRecurringPaymentsContext();
  const contacts = useRecurringContactSummaries();
  const [prefill] = React.useState(readPrefillFromHash);

  const [recipientKind, setRecipientKind] = React.useState<
    RecurringPaymentRecipient["kind"]
  >(prefill.lnAddress && !prefill.contactId ? "lnAddress" : "contact");
  const [contactId, setContactId] = React.useState(prefill.contactId);
  const [lnAddress, setLnAddress] = React.useState(prefill.lnAddress);
  const [recipientLocked, setRecipientLocked] = React.useState(
    Boolean(prefill.contactId || prefill.lnAddress),
  );
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
        .sort((a, b) => contactLabel(a).localeCompare(contactLabel(b))),
    [contacts],
  );

  const selectedContact = contactId ? contacts.get(contactId) : undefined;
  const recipientName =
    recipientKind === "contact"
      ? selectedContact
        ? contactLabel(selectedContact)
        : ""
      : lnAddress.trim();
  const intervalCount = parsePositiveInt(intervalCountText);
  const intervalPreview =
    intervalCount === null
      ? null
      : describeRecurringInterval(
          { unit: intervalUnit, count: intervalCount },
          t,
        );

  const submit = (): void => {
    const trimmedTitle = title.trim() || recipientName;
    const amountSat = parsePositiveInt(amountText);
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

  const lockedPictureUrl = selectedContact?.npub
    ? nostrPictureByNpub[selectedContact.npub] ||
      deriveDefaultProfile(selectedContact.npub).pictureUrl
    : null;

  const recipientField =
    recipientLocked && recipientName ? (
      <div className="contact-header recurring-recipient-header">
        <div className="contact-avatar is-large" aria-hidden="true">
          {recipientKind === "contact" ? (
            <Avatar
              pictureUrl={lockedPictureUrl}
              fallback={getInitials(recipientName)}
              fallbackClassName="contact-avatar-fallback"
              loading="lazy"
            />
          ) : (
            <span className="contact-avatar-fallback">⚡️</span>
          )}
        </div>
        <div className="contact-header-text">
          <h3 className="unspaced">{recipientName}</h3>
          <button
            type="button"
            className="wallet-subtle-link recurring-inline-link"
            onClick={() => setRecipientLocked(false)}
          >
            {t("recurringChangeRecipient")}
          </button>
        </div>
      </div>
    ) : (
      <>
        <div
          className="contact-group-selector recurring-pills"
          role="radiogroup"
          aria-label={t("recurringRecipientLabel")}
        >
          {(["contact", "lnAddress"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              className={
                recipientKind === kind
                  ? "group-filter-btn contact-group-pill is-active"
                  : "group-filter-btn contact-group-pill"
              }
              aria-pressed={recipientKind === kind}
              onClick={() => setRecipientKind(kind)}
            >
              {kind === "contact" ? t("contact") : t("lightningAddress")}
            </button>
          ))}
        </div>
        {recipientKind === "contact" ? (
          <select
            id="recurringContact"
            className="recurring-select"
            value={contactId}
            onChange={(event) => setContactId(event.target.value)}
          >
            <option value="">{t("recurringSelectContact")}</option>
            {payableContacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contactLabel(contact)}
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
      </>
    );

  return (
    <section className="panel panel-plain">
      <div className="form-grid">
        <div className="form-col recurring-form">
          <label>{t("recurringRecipientLabel")}</label>
          {recipientField}

          <label htmlFor="recurringAmount">{t("recurringAmountLabel")}</label>
          <div className="recurring-amount-field">
            <input
              id="recurringAmount"
              value={amountText}
              onChange={(event) => setAmountText(event.target.value)}
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="0"
            />
            <span className="recurring-amount-unit" aria-hidden="true">
              sat
            </span>
          </div>

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
          </div>
          <div
            className="contact-group-selector recurring-pills"
            role="radiogroup"
            aria-label={t("recurringIntervalLabel")}
          >
            {RECURRING_INTERVAL_UNITS.map((unit) => (
              <button
                key={unit}
                type="button"
                className={
                  intervalUnit === unit
                    ? "group-filter-btn contact-group-pill is-active"
                    : "group-filter-btn contact-group-pill"
                }
                aria-pressed={intervalUnit === unit}
                onClick={() => setIntervalUnit(unit)}
              >
                {t(UNIT_LABEL_KEYS[unit])}
              </button>
            ))}
          </div>
          {intervalPreview ? (
            <p className="muted recurring-hint recurring-interval-preview">
              <Repeat size={14} aria-hidden="true" /> {intervalPreview}
            </p>
          ) : null}

          <label htmlFor="recurringFirstRun">
            {t("recurringFirstRunLabel")}
          </label>
          <input
            id="recurringFirstRun"
            type="datetime-local"
            value={firstRunText}
            onChange={(event) => setFirstRunText(event.target.value)}
          />

          <label htmlFor="recurringTitle">{t("recurringTitleLabel")}</label>
          <input
            id="recurringTitle"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={recipientName || t("recurringTitlePlaceholder")}
            maxLength={200}
          />

          <label htmlFor="recurringMaxRuns">{t("recurringMaxRunsLabel")}</label>
          <input
            id="recurringMaxRuns"
            value={maxRunsText}
            onChange={(event) => setMaxRunsText(event.target.value)}
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder={t("recurringMaxRunsPlaceholder")}
          />

          <label htmlFor="recurringNote">{t("recurringNoteLabel")}</label>
          <input
            id="recurringNote"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={500}
          />

          {error ? <p className="error-text">{error}</p> : null}
          <p className="muted recurring-hint">{t("recurringOnlyWhileOpen")}</p>

          <div className="actions">
            <button type="button" className="btn-wide" onClick={submit}>
              <span className="btn-label-with-icon">
                <span className="btn-label-icon" aria-hidden="true">
                  <Repeat size={18} />
                </span>
                <span>{t("recurringSave")}</span>
              </span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
