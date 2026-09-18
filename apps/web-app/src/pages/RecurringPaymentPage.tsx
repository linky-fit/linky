import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useRecurringPaymentsContext } from "../app/context/RecurringPaymentsContext";
import {
  recurringRecipientLabel,
  useRecurringContactSummaries,
  useRecurringPaymentOrders,
} from "../app/hooks/payments/useRecurringPaymentOrders";
import {
  describeRecurringInterval,
  recurringLastRunLabel,
  recurringOrderState,
} from "../app/lib/recurringPaymentDisplay";
import { navigateTo } from "../hooks/useRouting";
import { normalizeLocale } from "../utils/formatting";
import { nowSeconds } from "../utils/time";

interface RecurringPaymentPageProps {
  id: string;
}

export function RecurringPaymentPage({
  id,
}: RecurringPaymentPageProps): React.ReactElement {
  const { cashuIsBusy, formatDisplayedAmountText, lang, t } = useAppShellCore();
  const {
    bindRecurringPaymentToThisDevice,
    deviceId,
    pendingRecurringPaymentDeleteId,
    requestDeleteRecurringPayment,
    runRecurringPaymentNow,
    setRecurringPaymentPaused,
  } = useRecurringPaymentsContext();
  const orders = useRecurringPaymentOrders();
  const contacts = useRecurringContactSummaries();
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
      <section className="panel">
        <p className="muted">{t("recurringNotFound")}</p>
      </section>
    );
  }

  const nowSec = nowSeconds();
  const state = recurringOrderState(order, nowSec);
  const formatDate = (epochSec: number): string =>
    dateFormatter.format(new Date(epochSec * 1000));
  const runsOnThisDevice =
    order.executorDeviceId === null || order.executorDeviceId === deviceId;
  const lastRun = recurringLastRunLabel(order, t);
  const runsText =
    order.schedule.maxRuns === null
      ? String(order.schedule.runCount)
      : `${order.schedule.runCount} / ${order.schedule.maxRuns}`;
  const deleteArmed = pendingRecurringPaymentDeleteId === order.id;

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

  return (
    <section className="panel">
      <h3 className="unspaced">{order.title}</h3>
      {row(
        t("recurringRecipientLabel"),
        recurringRecipientLabel(order, contacts),
      )}
      {row(
        t("recurringAmountLabel"),
        formatDisplayedAmountText(order.amountSat),
      )}
      {row(
        t("recurringIntervalLabel"),
        describeRecurringInterval(order.schedule.interval, t),
      )}
      {row(t("recurringFirstRunLabel"), formatDate(order.schedule.anchorAtSec))}
      {row(
        t("recurringNextRun"),
        state === "active"
          ? formatDate(order.schedule.nextDueAtSec)
          : state === "paused"
            ? t("recurringStatusPaused")
            : t("recurringStatusFinished"),
      )}
      {order.lastRunAtSec !== null
        ? row(
            t("recurringLastRun"),
            `${formatDate(order.lastRunAtSec)}${lastRun ? ` · ${lastRun}` : ""}`,
          )
        : null}
      {row(t("recurringRunsCount"), runsText)}
      {order.note ? row(t("recurringNoteLabel"), order.note) : null}
      {row(
        t("recurringDeviceLabel"),
        runsOnThisDevice
          ? t("recurringRunsOnThisDevice")
          : t("recurringRunsOnOtherDevice"),
      )}

      <div className="actions recurring-actions">
        {state !== "finished" ? (
          <button
            type="button"
            className="btn-wide secondary"
            onClick={() => setRecurringPaymentPaused(order, state !== "paused")}
          >
            {state === "paused" ? t("recurringResume") : t("recurringPause")}
          </button>
        ) : null}
        {!runsOnThisDevice ? (
          <button
            type="button"
            className="btn-wide secondary"
            onClick={() => bindRecurringPaymentToThisDevice(order)}
          >
            {t("recurringBindToThisDevice")}
          </button>
        ) : null}
        {state === "active" ? (
          <button
            type="button"
            className="btn-wide"
            disabled={cashuIsBusy}
            onClick={() => void runRecurringPaymentNow(order)}
          >
            {t("recurringRunNow")}
          </button>
        ) : null}
        <button
          type="button"
          className={deleteArmed ? "btn-wide danger" : "btn-wide secondary"}
          onClick={() => {
            if (requestDeleteRecurringPayment(order)) {
              navigateTo({ route: "recurringPayments" });
            }
          }}
        >
          {deleteArmed ? t("deleteArmedHint") : t("delete")}
        </button>
      </div>
    </section>
  );
}
