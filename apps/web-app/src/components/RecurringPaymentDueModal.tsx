import { RECURRING_CONFIRM_SEC } from "@linky-fit/recurring-payment";
import { Pill, Stack, Text } from "@linky-fit/ui";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useRecurringPaymentsContext } from "../app/context/RecurringPaymentsContext";
import { useNowSeconds } from "../app/hooks/payments/useNowSeconds";
import {
  recurringRecipientLabel,
  useRecurringContactSummaries,
  useRecurringPaymentOrders,
} from "../app/hooks/payments/useRecurringPaymentOrders";
import { formatRecurringAmountParts } from "../app/lib/recurringAmount";
import { describeRecurringInterval } from "../app/lib/recurringPaymentDisplay";
import { PaymentConfirmDialog } from "./PaymentConfirmDialog";
import { RecurringContactAvatar } from "./RecurringContactAvatar";

/**
 * A due recurring payment about to go out while Linky is open: the payment
 * confirm dialog with the recipient, Pay with a filling bar as the countdown,
 * or Cancel this period. When the bar is full the payment is sent without
 * further input and the same sheet turns into the paid confirmation.
 */
export function RecurringPaymentDueModal(): React.ReactElement | null {
  const {
    cashuIsBusy,
    displayCurrency,
    fiatRates,
    formatDisplayedAmountParts,
    lang,
    t,
  } = useAppShellCore();
  const { cancelDue, confirmDueNow, dueConfirmation } =
    useRecurringPaymentsContext();
  const orders = useRecurringPaymentOrders();
  const contacts = useRecurringContactSummaries();
  const nowSec = useNowSeconds(dueConfirmation !== null);
  const [isDeciding, setIsDeciding] = React.useState(false);
  const firedForRef = React.useRef<string | null>(null);

  const sendAtSec = dueConfirmation?.sendAtSec ?? null;
  const confirmationKey = dueConfirmation
    ? `${dueConfirmation.orderId}:${dueConfirmation.dueAtSec}`
    : null;
  React.useEffect(() => {
    if (
      confirmationKey === null ||
      sendAtSec === null ||
      nowSec < sendAtSec ||
      firedForRef.current === confirmationKey
    ) {
      return;
    }
    firedForRef.current = confirmationKey;
    void confirmDueNow();
  }, [confirmDueNow, confirmationKey, nowSec, sendAtSec]);

  if (dueConfirmation === null || sendAtSec === null) return null;
  const order =
    orders.find((candidate) => candidate.id === dueConfirmation.orderId) ??
    null;

  const decide = async (action: () => Promise<void>): Promise<void> => {
    setIsDeciding(true);
    try {
      await action();
    } finally {
      setIsDeciding(false);
    }
  };

  // The bar glides toward the next tick's value, so it is full as the payment goes out.
  const elapsedSec = RECURRING_CONFIRM_SEC - Math.max(0, sendAtSec - nowSec);

  return (
    <PaymentConfirmDialog
      amountSat={dueConfirmation.amountSat}
      amountParts={
        order
          ? formatRecurringAmountParts(order.amount, {
              displayCurrency,
              fiatRates,
              formatSat: formatDisplayedAmountParts,
              lang,
            })
          : undefined
      }
      cancelLabel={t("recurringDueCancel")}
      closeOnBackdrop={false}
      confirmLabel={t("recurringRunNow")}
      description={
        <Stack alignItems="center" gap="$sm">
          <RecurringContactAvatar
            contact={order ? contacts.get(order.contactId) : undefined}
            size="lg"
          />
          <Text variant="label" bold textAlign="center" numberOfLines={1}>
            {order ? recurringRecipientLabel(order, contacts) : ""}
          </Text>
        </Stack>
      }
      isBusy={cashuIsBusy || isDeciding}
      label={t("recurringDueTitle")}
      layout="description-first"
      confirmProgress={(elapsedSec + 1) / RECURRING_CONFIRM_SEC}
      meta={
        order ? (
          <Stack alignItems="center" gap="$xs">
            {order.note ? (
              <Text
                variant="caption"
                color="$colorSubtle"
                textAlign="center"
                numberOfLines={2}
                testID="recurring-due-note"
              >
                {order.note}
              </Text>
            ) : null}
            <Pill
              size="sm"
              tone="neutral"
              label={describeRecurringInterval(order.schedule.interval, t)}
              testID="recurring-due-interval"
            />
          </Stack>
        ) : undefined
      }
      onClose={() => void decide(cancelDue)}
      onConfirm={() => decide(confirmDueNow)}
    />
  );
}
