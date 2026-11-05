import {
  RegistryContext,
  useAtomSet,
  useAtomValue,
} from "@linky-fit/linkstr-react";
import type { ContactId } from "@linky-fit/linksync";
import type { RecurringIntervalUnit } from "@linky-fit/recurring-payment";
import { Button, SegmentedControl, Stack, Text } from "@linky-fit/ui";
import React from "react";
import { useContacts } from "../app/hooks/contacts/useDisplayContacts";
import { useRecurringPaymentsActions } from "../app/hooks/payments/useRecurringPaymentsActions";
import {
  useDisplayAmounts,
  usePushToast,
  useTranslation,
} from "../app/hooks/shell";
import { useSetNavIntent } from "../app/hooks/shell/navIntents";
import { useLinkyContact } from "../app/hooks/useFeedbackContact";
import { recurringAmountFromInput } from "../app/lib/recurringAmount";
import { nextFullHourSec } from "../app/lib/recurringPaymentDisplay";
import { contactsOnboardingHasSupportedAtom } from "../app/state/contacts/onboarding";
import {
  contactPaymentIntentAtom,
  payAmountAtom,
} from "../app/state/wallet/contactPay";
import { walletOpRunningAtom } from "../app/state/wallet/opQueue";
import { AmountKeypad } from "../components/AmountKeypad";
import { useAmountInputKeypad } from "../components/useAmountInputKeypad";
import { navigateTo } from "../hooks/useRouting";
import type { I18nKey } from "../i18n";
import { nowSeconds } from "../utils/time";

type Cadence = "once" | Extract<RecurringIntervalUnit, "week" | "month">;

const CADENCES: ReadonlyArray<{ key: Cadence; label: I18nKey }> = [
  { key: "once", label: "supportOnce" },
  { key: "week", label: "recurringPresetWeekly" },
  { key: "month", label: "recurringPresetMonthly" },
];

/** The suggested contribution; the user changes it on the keypad. */
export const DEFAULT_SUPPORT_AMOUNT_SAT = "10000";

/**
 * A contribution to the Linky team: once, through the contact pay screen,
 * or as a recurring payment created here with the first run at the next
 * full hour.
 */
export function SupportLinkyPage(): React.ReactElement {
  const { t } = useTranslation();
  const { displayCurrency, fiatRates } = useDisplayAmounts();
  const pushToast = usePushToast();
  const registry = React.useContext(RegistryContext);
  const cashuIsBusy = useAtomValue(walletOpRunningAtom);
  const contacts = useContacts();
  const linky = useLinkyContact();
  const { createRecurringPayment } = useRecurringPaymentsActions();
  const setContactPaymentIntent = useAtomSet(contactPaymentIntentAtom);
  const setContactPayBackToChat = useSetNavIntent("contactPayBackToChat");
  const setHasSupported = useAtomSet(contactsOnboardingHasSupportedAtom);

  const [cadence, setCadence] = React.useState<Cadence>("month");
  const [amount, setAmount] = React.useState(DEFAULT_SUPPORT_AMOUNT_SAT);
  const [isSaving, setIsSaving] = React.useState(false);
  // The contact whose row the submit waits for, when it was just saved.
  const [pendingContactId, setPendingContactId] =
    React.useState<ContactId | null>(null);
  const amountInput = useAmountInputKeypad({
    amount,
    initialDisplayValue: null,
    onAmountChange: setAmount,
  });

  const amountSat = Number.parseInt(amount.trim(), 10);
  const recurringAmount = recurringAmountFromInput({
    amountSat: amount,
    displayCurrency,
    displayValue: amountInput.inputDisplayValue,
    fiatRates,
  });
  const canSubmit =
    Number.isFinite(amountSat) &&
    amountSat > 0 &&
    (cadence === "once" || recurringAmount !== null) &&
    !cashuIsBusy;

  const submitFor = async (contactId: ContactId): Promise<void> => {
    if (cadence === "once") {
      registry.set(payAmountAtom, String(amountSat));
      setContactPaymentIntent("pay");
      setContactPayBackToChat(null);
      navigateTo({ route: "contactPay", id: contactId });
      return;
    }
    if (recurringAmount === null) return;
    setIsSaving(true);
    try {
      const saved = await createRecurringPayment({
        amount: recurringAmount,
        contactId,
        firstDueAtSec: nextFullHourSec(nowSeconds()),
        interval: { unit: cadence, count: 1 },
        note: null,
      });
      if (!saved) return;
    } finally {
      setIsSaving(false);
    }
    setHasSupported(true);
    pushToast(t("supportThanks"));
    navigateTo({ route: "wallet" });
  };
  const submitForRef = React.useRef(submitFor);
  submitForRef.current = submitFor;

  const pendingContactSaved =
    pendingContactId !== null &&
    contacts.some((contact) => contact.id === pendingContactId);
  React.useEffect(() => {
    if (pendingContactId === null || !pendingContactSaved) return;
    setPendingContactId(null);
    void submitForRef.current(pendingContactId);
  }, [pendingContactId, pendingContactSaved]);

  const submit = () => {
    const contactId = linky.ensure();
    if (contactId === null) return;
    if (contacts.some((contact) => contact.id === contactId)) {
      void submitFor(contactId);
    } else {
      setPendingContactId(contactId);
    }
  };

  return (
    <Stack gap="$lg">
      <Text color="$colorMuted">{t("supportLinkyIntro")}</Text>

      <Stack gap="$xs">
        <Text variant="label">{t("supportFrequencyLabel")}</Text>
        <SegmentedControl
          accessibilityLabel={t("supportFrequencyLabel")}
          value={cadence}
          options={CADENCES.map((option) => ({
            value: option.key,
            label: t(option.label),
          }))}
          onValueChange={setCadence}
        />
      </Stack>

      <AmountKeypad amount={amount} input={amountInput} />

      {cadence === "once" ? null : (
        <Text variant="caption" color="$colorMuted">
          {t("supportRecurringHint")}
        </Text>
      )}

      <Button
        icon={cadence === "once" ? "HeartHandshake" : "Repeat"}
        loading={isSaving || pendingContactId !== null}
        disabled={!canSubmit || isSaving || pendingContactId !== null}
        onPress={submit}
        data-guide="support-submit"
        testID="support-submit"
      >
        {cadence === "once"
          ? t("supportSubmitOnce")
          : t("supportSubmitRecurring")}
      </Button>
    </Stack>
  );
}
