import type { FC } from "react";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import {
  recurringRecipientLabel,
  useRecurringContactSummaries,
  useRecurringPaymentOrders,
} from "../app/hooks/payments/useRecurringPaymentOrders";
import {
  formatRecurringAmountText,
  recurringAmountSat,
} from "../app/lib/recurringAmount";
import {
  describeRecurringInterval,
  recurringOrderState,
} from "../app/lib/recurringPaymentDisplay";
import { navigateTo } from "../hooks/useRouting";
import { normalizeLocale } from "../utils/formatting";
import { nowSeconds } from "../utils/time";
import { RecurringContactAvatar } from "./RecurringContactAvatar";

/** Every recurring payment with its interval pill, amount, and next due date. */
export const RecurringPaymentsList: FC = () => {
  const {
    cashuBalance,
    displayCurrency,
    fiatRates,
    formatDisplayedAmountParts,
    lang,
    t,
  } = useAppShellCore();
  const orders = useRecurringPaymentOrders();
  const contacts = useRecurringContactSummaries();
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
  if (orders.length === 0) {
    return <p className="muted recurring-empty">{t("recurringEmpty")}</p>;
  }
  const nowSec = nowSeconds();

  return (
    <div className="transactions-list">
      {orders.map((order) => {
        const state = recurringOrderState(order, nowSec);
        const amountSat = recurringAmountSat(order.amount, fiatRates);
        const underfunded =
          state === "active" && amountSat !== null && cashuBalance < amountSat;
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
                    {state === "paused"
                      ? t("recurringStatusPaused")
                      : dateFormatter.format(
                          new Date(order.schedule.nextDueAtSec * 1000),
                        )}
                  </span>
                  <span className="pill pill-muted transaction-status-pill">
                    {describeRecurringInterval(order.schedule.interval, t)}
                  </span>
                  {underfunded ? (
                    <span className="recurring-underfunded-hint">
                      {t("recurringInsufficientFundsHint")}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="transaction-amount is-negative">
                {formatRecurringAmountText(order.amount, {
                  displayCurrency,
                  fiatRates,
                  formatSat: formatDisplayedAmountParts,
                  lang,
                })}
              </div>
            </article>
          </button>
        );
      })}
    </div>
  );
};
