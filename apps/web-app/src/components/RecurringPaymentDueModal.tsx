import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useRecurringPaymentsContext } from "../app/context/RecurringPaymentsContext";
import { useNowSeconds } from "../app/hooks/payments/useNowSeconds";
import {
  recurringRecipientLabel,
  useRecurringContactSummaries,
  useRecurringPaymentOrders,
} from "../app/hooks/payments/useRecurringPaymentOrders";
import { RECURRING_CONFIRM_SEC } from "../app/lib/recurringPaymentTick";
import type { RecurringInterval } from "../app/lib/recurringSchedule";
import type { I18nKey } from "../i18n";
import { PaymentConfirmDialog } from "./PaymentConfirmDialog";
import { RecurringContactAvatar } from "./RecurringContactAvatar";

const readyKeyFor = (interval: RecurringInterval | null): I18nKey => {
  if (interval === null || interval.count !== 1) return "recurringDueReady";
  switch (interval.unit) {
    case "day":
      return "recurringDueReadyDaily";
    case "week":
      return "recurringDueReadyWeekly";
    case "month":
      return "recurringDueReadyMonthly";
    case "hour":
      return "recurringDueReady";
  }
};

/**
 * A due recurring payment about to go out while Linky is open: the payment
 * confirm dialog with the recipient, Pay with a filling bar as the countdown,
 * or Cancel this period. When the bar is full the payment is sent without
 * further input and the same sheet turns into the paid confirmation.
 */
export function RecurringPaymentDueModal(): React.ReactElement | null {
  const { cashuIsBusy, t } = useAppShellCore();
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

  return (
    <PaymentConfirmDialog
      amountSat={dueConfirmation.amountSat}
      cancelLabel={t("recurringDueCancel")}
      closeOnBackdrop={false}
      confirmLabel={t("recurringRunNow")}
      description={
        <div className="paid-figure is-out recurring-due-recipient">
          <RecurringContactAvatar
            className="contact-avatar is-xl paid-avatar"
            contact={order ? contacts.get(order.contactId) : undefined}
          />
          <div className="recurring-due-name recurring-truncate">
            {order ? recurringRecipientLabel(order, contacts) : ""}
          </div>
        </div>
      }
      isBusy={cashuIsBusy || isDeciding}
      label={t("recurringDueTitle")}
      layout="description-first"
      confirmProgress={
        (RECURRING_CONFIRM_SEC - Math.max(0, sendAtSec - nowSec)) /
        RECURRING_CONFIRM_SEC
      }
      meta={t(readyKeyFor(order?.schedule.interval ?? null))}
      onClose={() => void decide(cancelDue)}
      onConfirm={() => decide(confirmDueNow)}
    />
  );
}
