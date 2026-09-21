import type { FC } from "react";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useNowSeconds } from "../app/hooks/payments/useNowSeconds";
import {
  recurringRecipientLabel,
  useRecurringContactSummaries,
  useRecurringPaymentOrders,
} from "../app/hooks/payments/useRecurringPaymentOrders";
import { formatCountdown } from "../app/lib/recurringCountdown";
import {
  describeRecurringInterval,
  recurringOrderState,
} from "../app/lib/recurringPaymentDisplay";
import { recurringUpcoming } from "../app/lib/recurringPaymentTick";
import { navigateTo } from "../hooks/useRouting";
import { normalizeLocale } from "../utils/formatting";
import { RecurringContactAvatar } from "./RecurringContactAvatar";

/** Every recurring payment with its interval, amount, and next due time. */
export const RecurringPaymentsList: FC = () => {
  const { cashuBalance, formatDisplayedAmountText, lang, t } =
    useAppShellCore();
  const orders = useRecurringPaymentOrders();
  const contacts = useRecurringContactSummaries();
  const nowSec = useNowSeconds(orders.length > 0);
  const dateFormatter = React.useMemo(
    () =>
      new Intl.DateTimeFormat(normalizeLocale(lang), {
        day: "numeric",
        month: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    [lang],
  );
  if (orders.length === 0) {
    return <p className="muted recurring-empty">{t("recurringEmpty")}</p>;
  }

  return (
    <div className="transactions-list">
      {orders.map((order) => {
        const state = recurringOrderState(order, nowSec);
        const upcoming = recurringUpcoming(order, nowSec);
        const underfunded =
          state === "active" && cashuBalance < order.amountSat;
        const when =
          state === "paused"
            ? t("recurringStatusPaused")
            : state === "finished"
              ? t("recurringStatusFinished")
              : upcoming?.sendAtSec != null
                ? formatCountdown(upcoming.sendAtSec, nowSec)
                : dateFormatter.format(
                    new Date(order.schedule.nextDueAtSec * 1000),
                  );
        return (
          <button
            type="button"
            key={order.id}
            className={`transaction-card recurring-order-card${state === "active" ? "" : " is-unsuccessful"}`}
            onClick={() =>
              navigateTo({ route: "recurringPayment", id: order.id })
            }
          >
            <article className="transaction-row">
              <RecurringContactAvatar
                className="contact-avatar transaction-avatar"
                contact={contacts.get(order.contactId)}
              />
              <div className="transaction-main">
                <div className="transaction-title">
                  {recurringRecipientLabel(order, contacts)}
                </div>
                <div className="transaction-meta">
                  <span>
                    {describeRecurringInterval(order.schedule.interval, t)}
                  </span>
                  <span
                    className={
                      upcoming?.sendAtSec != null && state === "active"
                        ? "pill transaction-status-pill"
                        : "pill pill-muted transaction-status-pill"
                    }
                  >
                    {when}
                  </span>
                  {underfunded ? (
                    <span className="recurring-underfunded-hint">
                      {t("recurringInsufficientFundsHint")}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="transaction-amount is-negative">
                {formatDisplayedAmountText(order.amountSat)}
              </div>
            </article>
          </button>
        );
      })}
    </div>
  );
};
