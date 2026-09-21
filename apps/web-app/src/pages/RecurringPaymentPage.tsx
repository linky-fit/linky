import { Pause, Play, Send, Trash2 } from "lucide-react";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useRecurringPaymentsContext } from "../app/context/RecurringPaymentsContext";
import { useNowSeconds } from "../app/hooks/payments/useNowSeconds";
import {
  recurringRecipientLabel,
  useRecurringContactSummaries,
  useRecurringPaymentOrders,
} from "../app/hooks/payments/useRecurringPaymentOrders";
import { formatCountdown } from "../app/lib/recurringCountdown";
import {
  describeRecurringInterval,
  recurringLastRunLabel,
  recurringOrderState,
} from "../app/lib/recurringPaymentDisplay";
import { recurringUpcoming } from "../app/lib/recurringPaymentTick";
import { RecurringContactAvatar } from "../components/RecurringContactAvatar";
import { navigateTo } from "../hooks/useRouting";
import { normalizeLocale } from "../utils/formatting";

interface RecurringPaymentPageProps {
  id: string;
}

export function RecurringPaymentPage({
  id,
}: RecurringPaymentPageProps): React.ReactElement {
  const { cashuIsBusy, formatDisplayedAmountText, lang, t } = useAppShellCore();
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
  const nowSec = useNowSeconds(order !== null);
  const dateFormatter = React.useMemo(
    () =>
      new Intl.DateTimeFormat(normalizeLocale(lang), {
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    [lang],
  );

  if (order === null) {
    return (
      <section className="panel panel-plain">
        <p className="muted">{t("recurringNotFound")}</p>
      </section>
    );
  }

  const state = recurringOrderState(order, nowSec);
  const upcoming = recurringUpcoming(order, nowSec);
  const formatDate = (epochSec: number): string =>
    dateFormatter.format(new Date(epochSec * 1000));
  const lastRun = recurringLastRunLabel(order, t);
  const runsText =
    order.schedule.maxRuns === null
      ? String(order.schedule.runCount)
      : `${order.schedule.runCount} / ${order.schedule.maxRuns}`;
  const deleteArmed = pendingRecurringPaymentDeleteId === order.id;
  const stateLabel =
    state === "paused"
      ? t("recurringStatusPaused")
      : state === "finished"
        ? t("recurringStatusFinished")
        : t("recurringStatusActive");
  const nextText =
    upcoming?.sendAtSec != null
      ? upcoming.sendAtSec > nowSec
        ? formatCountdown(upcoming.sendAtSec, nowSec)
        : t("recurringRunRunning")
      : formatDate(order.schedule.nextDueAtSec);

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
              {stateLabel}
            </span>
          </div>

          <div className="recurring-detail-amount">
            <span className="recurring-detail-amount-value">
              {formatDisplayedAmountText(order.amountSat)}
            </span>
          </div>

          {state === "active" ? row(t("recurringNextRun"), nextText) : null}
          {order.lastRunAtSec !== null
            ? row(
                t("recurringLastRun"),
                `${formatDate(order.lastRunAtSec)}${lastRun ? ` · ${lastRun}` : ""}`,
              )
            : null}
          {row(t("recurringRunsCount"), runsText)}

          <div className="actions recurring-actions">
            {state === "active" ? (
              <button
                type="button"
                className="btn-wide"
                disabled={cashuIsBusy || isRunning}
                onClick={() => void payNow()}
              >
                <span className="btn-label-with-icon">
                  <span className="btn-label-icon" aria-hidden="true">
                    {isRunning ? (
                      <span className="btn-spinner" />
                    ) : (
                      <Send size={18} />
                    )}
                  </span>
                  <span>
                    {isRunning ? t("payPaying") : t("recurringRunNow")}
                  </span>
                </span>
              </button>
            ) : null}
            {state !== "finished" ? (
              <button
                type="button"
                className="btn-wide secondary"
                onClick={() =>
                  setRecurringPaymentPaused(order, state !== "paused")
                }
              >
                <span className="btn-label-with-icon">
                  <span className="btn-label-icon" aria-hidden="true">
                    {state === "paused" ? (
                      <Play size={18} />
                    ) : (
                      <Pause size={18} />
                    )}
                  </span>
                  <span>
                    {state === "paused"
                      ? t("recurringResume")
                      : t("recurringPause")}
                  </span>
                </span>
              </button>
            ) : null}
            <button
              type="button"
              className={deleteArmed ? "btn-wide danger" : "btn-wide secondary"}
              onClick={() => {
                if (requestDeleteRecurringPayment(order)) {
                  navigateTo({ route: "transactions" });
                }
              }}
            >
              <span className="btn-label-with-icon">
                <span className="btn-label-icon" aria-hidden="true">
                  <Trash2 size={18} />
                </span>
                <span>{deleteArmed ? t("deleteArmedHint") : t("delete")}</span>
              </span>
            </button>
          </div>
          <p className="muted recurring-hint">{t("recurringOnlyWhileOpen")}</p>
        </div>
      </div>
    </section>
  );
}
