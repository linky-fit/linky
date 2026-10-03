import type { RecurringPaymentId } from "@linky-fit/linksync";
import {
  currentTimeZone,
  isFiatRecurringAmount,
  recurringAmountSat,
  recurringDueAt,
  recurringFiatValue,
  type RecurringInterval,
  type RecurringIntervalUnit,
  type RecurringPaymentOrder,
} from "@linky-fit/recurring-payment";
import {
  Button,
  EmptyState,
  ListRow,
  Notice,
  Row,
  SegmentedControl,
  Stack,
  Text,
  TextField,
} from "@linky-fit/ui";
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
import { AmountKeypad } from "../components/AmountKeypad";
import { PaymentNoteInput } from "../components/PaymentNoteInput";
import { RecurringContactAvatar } from "../components/RecurringContactAvatar";
import { useAmountInputKeypad } from "../components/useAmountInputKeypad";
import { navigateTo } from "../hooks/useRouting";
import type { I18nKey } from "../i18n";
import { normalizeLocale } from "../utils/formatting";
import { formatMintHost } from "../utils/mint";
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
  note: string;
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
    note: "",
    repeatsPayment: Boolean(contactId) && amount > 0,
  };
};

interface RecurringPaymentFormPageProps {
  editId?: RecurringPaymentId;
}

/** New payment, or an existing one when `editId` is set (same fields, saved in place). */
export function RecurringPaymentFormPage({
  editId,
}: RecurringPaymentFormPageProps): React.ReactElement | null {
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
      note: order.note ?? "",
      repeatsPayment: false,
    };
    // The form takes its initial values once; later rate or order changes
    // must not reset what the user is typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId, order === null]);

  if (initial === null) {
    return orders.length === 0 ? null : (
      <EmptyState title={t("recurringNotFound")} />
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
  const { cashuIsBusy, displayCurrency, fiatRates, lang, t } =
    useAppShellCore();
  const { createRecurringPayment, defaultMintUrl, updateRecurringPayment } =
    useRecurringPaymentsContext();
  const mintUrl = order ? order.mintUrl : defaultMintUrl;
  const contacts = useRecurringContactSummaries();

  const [contactId, setContactId] = React.useState(initial.contactId);
  const [search, setSearch] = React.useState("");
  const [amount, setAmount] = React.useState(initial.amountSat);
  const [note, setNote] = React.useState(initial.note);
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
      note: note.trim() || null,
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
    <Stack gap="$lg">
      <Row gap="$md" alignItems="center">
        <RecurringContactAvatar contact={contact} size="md" />
        <Stack flex={1} gap="$xxs" alignItems="flex-start">
          <Text
            variant="title"
            numberOfLines={1}
            testID="recurring-recipient-name"
          >
            {contactSummaryLabel(contact)}
          </Text>
          <Button variant="ghost" size="sm" onPress={() => setContactId("")}>
            {t("recurringChangeRecipient")}
          </Button>
        </Stack>
      </Row>

      <AmountKeypad
        amount={amount}
        input={amountInput}
        below={<PaymentNoteInput onChange={setNote} t={t} value={note} />}
      />

      <Stack gap="$xs">
        <Text variant="label">{t("recurringFrequencyLabel")}</Text>
        <SegmentedControl
          accessibilityLabel={t("recurringFrequencyLabel")}
          value={frequency}
          options={FREQUENCIES.map((option) => ({
            value: option.key,
            label: t(option.label),
          }))}
          onValueChange={setFrequency}
        />
      </Stack>

      <TextField
        label={order ? t("recurringNextRun") : t("recurringFirstRunLabel")}
        type="datetime-local"
        min={epochToDateTimeLocal(earliestFirstRunSec)}
        value={firstRunText ?? epochToDateTimeLocal(defaultFirstRunSec)}
        onChangeText={setFirstRunText}
        error={firstRunInPast ? t("recurringFirstRunInPast") : undefined}
        hint={
          secondRunSec === null
            ? t("recurringInvalidForm")
            : t("recurringSummaryNext").replace(
                "{date}",
                formatDate(secondRunSec),
              )
        }
      />

      <ListRow
        title={t("recurringMintLabel")}
        value={formatMintHost(mintUrl)}
      />

      {error ? <Notice tone="danger" title={error} /> : null}
      <Text variant="caption" color="$colorMuted">
        {t("recurringOnlyWhileOpen")}
      </Text>

      <Button
        icon="Repeat"
        loading={isSaving}
        disabled={!canSave || isSaving}
        onPress={() => void submit()}
      >
        {order ? t("recurringSaveChanges") : t("recurringSave")}
      </Button>
    </Stack>
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
    <Stack gap="$md">
      <TextField
        label={t("recurringChooseContact")}
        value={search}
        onChangeText={onSearch}
        placeholder={t("recurringSearchContacts")}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
      />
      {contacts.length === 0 ? (
        <EmptyState title={t("recurringNoPayableContacts")} />
      ) : (
        <Stack gap="$xs">
          {contacts.map((candidate) => (
            <ListRow
              key={candidate.id}
              testID="recurring-picker-contact"
              leading={<RecurringContactAvatar contact={candidate} />}
              title={contactSummaryLabel(candidate)}
              description={
                candidate.name && candidate.lnAddress
                  ? candidate.lnAddress
                  : undefined
              }
              onPress={() => onPick(candidate)}
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
}
