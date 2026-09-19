import type { FC } from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useRecurringPaymentsContext } from "../app/context/RecurringPaymentsContext";
import { useNowSeconds } from "../app/hooks/payments/useNowSeconds";
import {
  recurringRecipientLabel,
  useRecurringContactSummaries,
  useRecurringPaymentOrders,
} from "../app/hooks/payments/useRecurringPaymentOrders";
import { formatCountdown } from "../app/lib/recurringCountdown";
import { recurringUpcoming } from "../app/lib/recurringPaymentTick";
import { navigateTo } from "../hooks/useRouting";

/**
 * Shown on every device while a claimed recurring payment waits out its notice
 * window, so the user can cancel it or send it right away.
 */
export const RecurringUpcomingBanner: FC = () => {
  const { cashuIsBusy, formatDisplayedAmountText, t } = useAppShellCore();
  const { runRecurringPaymentNow, skipNextRecurringPayment } =
    useRecurringPaymentsContext();
  const orders = useRecurringPaymentOrders();
  const contacts = useRecurringContactSummaries();
  const nowSec = useNowSeconds(orders.length > 0);

  const pending = orders.flatMap((order) => {
    const upcoming = recurringUpcoming(order, nowSec);
    return upcoming?.sendAtSec != null
      ? [{ order, sendAtSec: upcoming.sendAtSec }]
      : [];
  });
  const first = pending[0];
  if (!first) return null;

  const values = {
    amount: formatDisplayedAmountText(first.order.amountSat),
    name: recurringRecipientLabel(first.order, contacts),
  };
  const message = (
    first.sendAtSec > nowSec
      ? t("recurringUpcomingBanner").replace(
          "{time}",
          formatCountdown(first.sendAtSec, nowSec),
        )
      : t("recurringUpcomingSending")
  )
    .replace("{amount}", values.amount)
    .replace("{name}", values.name);

  return (
    <div
      className="pwa-update-banner recurring-upcoming-banner"
      role="status"
      aria-live="polite"
    >
      <button
        type="button"
        className="pwa-update-banner-text recurring-upcoming-text"
        onClick={() =>
          navigateTo({ route: "recurringPayment", id: first.order.id })
        }
      >
        {message}
        {pending.length > 1 ? ` (+${pending.length - 1})` : ""}
      </button>
      <button
        type="button"
        className="pwa-update-banner-button"
        onClick={() => skipNextRecurringPayment(first.order)}
      >
        {t("cancel")}
      </button>
      <button
        type="button"
        className="pwa-update-banner-button"
        disabled={cashuIsBusy}
        onClick={() => void runRecurringPaymentNow(first.order)}
      >
        {t("recurringPayNowShort")}
      </button>
    </div>
  );
};
