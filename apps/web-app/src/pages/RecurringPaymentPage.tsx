import { Pause, Play, Send, Trash2 } from "lucide-react";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useRecurringPaymentsContext } from "../app/context/RecurringPaymentsContext";
import {
  recurringRecipientLabel,
  useRecurringContactSummaries,
  useRecurringPaymentOrders,
} from "../app/hooks/payments/useRecurringPaymentOrders";
import {
  formatRecurringAmountText,
  recurringAmountSecondaryText,
} from "../app/lib/recurringAmount";
import {
  describeRecurringInterval,
  recurringLastRunLabel,
  recurringOrderState,
} from "../app/lib/recurringPaymentDisplay";
import { RecurringContactAvatar } from "../components/RecurringContactAvatar";
import { navigateTo } from "../hooks/useRouting";
import { normalizeLocale } from "../utils/formatting";
import { nowSeconds } from "../utils/time";

interface RecurringPaymentPageProps {
  id: string;
}

export function RecurringPaymentPage({
  id,
}: RecurringPaymentPageProps): React.ReactElement {
  const {
    cashuIsBusy,
    displayCurrency,
    fiatRates,
    formatDisplayedAmountParts,
    lang,
    t,
  } = useAppShellCore();
  const {
    pendingRecurringPaymentDeleteId,
    requestDeleteRecurringPayment,
    runRecurringPaymentNow,
    setRecurringPaymentPaused,
  } = useRecurringPaymentsContext();
  const orders = useRecurringPaymentOrders();
  const contacts = useRecurringContactSummaries();
  const [isRunning, setIsRunning] = React.useState(false);
  const order = orders.find((candidate) => candidate.id === id) ?? null;
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

  if (order === null) {
    return (
      <section className="panel panel-plain">
        <p className="muted">
          {orders.length === 0 ? "" : t("recurringNotFound")}
        </p>
      </section>
    );
  }

  const state = recurringOrderState(order, nowSeconds());
  const formatDate = (epochSec: number): string =>
    dateFormatter.format(new Date(epochSec * 1000));
  const lastRun = recurringLastRunLabel(order, t);
  const deleteArmed = pendingRecurringPaymentDeleteId === order.id;
  const amountText = formatRecurringAmountText(order.amount, {
    displayCurrency,
    fiatRates,
    formatSat: formatDisplayedAmountParts,
    lang,
  });
  const secondaryAmount = recurringAmountSecondaryText(
    order.amount,
    fiatRates,
    lang,
    t,
  );

  const row = (label: string, value: string): React.ReactElement => (
    <div className="settings-row">
      <div className="settings-left">
        <span className="settings-label">{label}</span>
      </div>
      <div className="settings-right">
        <span className="muted settings-value">{value}</span>
      </div>
    </div>
  );

  const payNow = async (): Promise<void> => {
    setIsRunning(true);
    try {
      await runRecurringPaymentNow(order);
    } finally {
      setIsRunning(false);
    }
  };

  const actionButton = (
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
    options: { className?: string; disabled?: boolean } = {},
  ): React.ReactElement => (
    <button
      type="button"
      className={options.className ?? "btn-wide secondary"}
      disabled={options.disabled ?? false}
      onClick={onClick}
    >
      <span className="btn-label-with-icon">
        <span className="btn-label-icon" aria-hidden="true">
          {icon}
        </span>
        <span>{label}</span>
      </span>
    </button>
  );

  return (
    <section className="panel panel-plain">
      <div className="form-grid">
        <div className="form-col recurring-detail">
          <div className="contact-header">
            <RecurringContactAvatar
              className="contact-avatar is-large"
              contact={contacts.get(order.contactId)}
            />
            <div className="contact-header-text">
              <h3 className="unspaced recurring-truncate">
                {recurringRecipientLabel(order, contacts)}
              </h3>
              <p className="muted unspaced">
                {describeRecurringInterval(order.schedule.interval, t)}
              </p>
            </div>
            <span
              className={`pill transaction-status-pill${state === "active" ? "" : " pill-muted"}`}
            >
              {state === "paused"
                ? t("recurringStatusPaused")
                : t("recurringStatusActive")}
            </span>
          </div>

          <div className="recurring-detail-amount">
            <span className="recurring-detail-amount-value">{amountText}</span>
            {secondaryAmount ? (
              <span className="muted recurring-detail-amount-secondary">
                {secondaryAmount}
              </span>
            ) : null}
          </div>

          {state === "active"
            ? row(
                t("recurringNextRun"),
                formatDate(order.schedule.nextDueAtSec),
              )
            : null}
          {order.lastRunAtSec !== null
            ? row(
                t("recurringLastRun"),
                `${formatDate(order.lastRunAtSec)}${lastRun ? ` · ${lastRun}` : ""}`,
              )
            : null}
          {row(t("recurringRunsCount"), String(order.schedule.runCount))}

          <div className="actions recurring-actions">
            {state === "active"
              ? actionButton(
                  isRunning ? t("payPaying") : t("recurringRunNow"),
                  isRunning ? (
                    <span className="btn-spinner" />
                  ) : (
                    <Send size={18} />
                  ),
                  () => void payNow(),
                  { className: "btn-wide", disabled: cashuIsBusy || isRunning },
                )
              : null}
            {actionButton(
              state === "paused" ? t("recurringResume") : t("recurringPause"),
              state === "paused" ? <Play size={18} /> : <Pause size={18} />,
              () => void setRecurringPaymentPaused(order, state !== "paused"),
            )}
            {actionButton(
              deleteArmed ? t("deleteArmedHint") : t("delete"),
              <Trash2 size={18} />,
              () => {
                void requestDeleteRecurringPayment(order).then((deleted) => {
                  if (deleted) navigateTo({ route: "transactions" });
                });
              },
              {
                className: deleteArmed
                  ? "btn-wide danger"
                  : "btn-wide secondary",
              },
            )}
          </div>
          <p className="muted recurring-hint">{t("recurringOnlyWhileOpen")}</p>
        </div>
      </div>
    </section>
  );
}
