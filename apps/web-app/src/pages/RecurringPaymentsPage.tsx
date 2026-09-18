import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import {
  recurringRecipientLabel,
  useRecurringContactSummaries,
  useRecurringPaymentOrders,
} from "../app/hooks/payments/useRecurringPaymentOrders";
import {
  describeRecurringInterval,
  recurringOrderState,
} from "../app/lib/recurringPaymentDisplay";
import type { RecurringPaymentOrder } from "../app/lib/recurringPaymentOrder";
import { Avatar } from "../components/Avatar";
import { deriveDefaultProfile } from "../derivedProfile";
import { navigateTo } from "../hooks/useRouting";
import { getInitials, normalizeLocale } from "../utils/formatting";
import { nowSeconds } from "../utils/time";

export function RecurringPaymentsPage(): React.ReactElement {
  const { formatDisplayedAmountText, lang, nostrPictureByNpub, t } =
    useAppShellCore();
  const orders = useRecurringPaymentOrders();
  const contacts = useRecurringContactSummaries();
  const nowSec = nowSeconds();
  const dateFormatter = React.useMemo(
    () =>
      new Intl.DateTimeFormat(normalizeLocale(lang), {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }),
    [lang],
  );

  const renderOrder = (order: RecurringPaymentOrder): React.ReactElement => {
    const contact =
      order.recipient.kind === "contact"
        ? contacts.get(order.recipient.contactId)
        : undefined;
    const pictureUrl =
      (contact?.npub ? nostrPictureByNpub[contact.npub] : null) ||
      (contact?.npub ? deriveDefaultProfile(contact.npub).pictureUrl : null);
    const state = recurringOrderState(order, nowSec);
    const stateLabel =
      state === "paused"
        ? t("recurringStatusPaused")
        : state === "finished"
          ? t("recurringStatusFinished")
          : null;
    return (
      <button
        type="button"
        key={order.id}
        className="transaction-card recurring-order-card"
        onClick={() => navigateTo({ route: "recurringPayment", id: order.id })}
      >
        <article className="transaction-row">
          <div className="contact-avatar transaction-avatar" aria-hidden="true">
            {contact ? (
              <Avatar
                pictureUrl={pictureUrl}
                fallback={getInitials(contact.name ?? "")}
                fallbackClassName="contact-avatar-fallback"
                loading="lazy"
              />
            ) : (
              <span className="contact-avatar-fallback transaction-icon-fallback">
                ⚡️
              </span>
            )}
          </div>
          <div className="transaction-main">
            <div className="transaction-title">{order.title}</div>
            <div className="transaction-subtitle">
              {recurringRecipientLabel(order, contacts)} ·{" "}
              {describeRecurringInterval(order.schedule.interval, t)}
            </div>
            <div className="transaction-meta">
              {state === "active" ? (
                <span>
                  {t("recurringNextRun")}:{" "}
                  {dateFormatter.format(
                    new Date(order.schedule.nextDueAtSec * 1000),
                  )}
                </span>
              ) : null}
              {stateLabel ? (
                <span className="pill pill-muted transaction-status-pill">
                  {stateLabel}
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
  };

  return (
    <section className="panel panel-plain recurring-payments-page">
      <p className="muted">{t("recurringOnlyWhileOpen")}</p>
      {orders.length === 0 ? (
        <p className="muted">{t("recurringEmpty")}</p>
      ) : (
        <div className="transactions-list">{orders.map(renderOrder)}</div>
      )}
      <div className="actions">
        <button
          type="button"
          className="btn-wide"
          onClick={() => navigateTo({ route: "recurringPaymentNew" })}
        >
          {t("recurringPaymentNewTitle")}
        </button>
      </div>
    </section>
  );
}
