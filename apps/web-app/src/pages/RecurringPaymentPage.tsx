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
  describeRecurringInterval,
  recurringLastRunLabel,
  recurringOrderState,
} from "../app/lib/recurringPaymentDisplay";
import { Avatar } from "../components/Avatar";
import { deriveDefaultProfile } from "../derivedProfile";
import { navigateTo } from "../hooks/useRouting";
import { getInitials, normalizeLocale } from "../utils/formatting";
import { nowSeconds } from "../utils/time";

interface RecurringPaymentPageProps {
  id: string;
}

export function RecurringPaymentPage({
  id,
}: RecurringPaymentPageProps): React.ReactElement {
  const {
    cashuIsBusy,
    formatDisplayedAmountText,
    lang,
    nostrPictureByNpub,
    t,
  } = useAppShellCore();
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
  const contact =
    order.recipient.kind === "contact"
      ? contacts.get(order.recipient.contactId)
      : undefined;
  const pictureUrl = contact?.npub
    ? nostrPictureByNpub[contact.npub] ||
      deriveDefaultProfile(contact.npub).pictureUrl
    : null;
  const recipient = recurringRecipientLabel(order, contacts);
  const stateLabel =
    state === "paused"
      ? t("recurringStatusPaused")
      : state === "finished"
        ? t("recurringStatusFinished")
        : t("recurringStatusActive");

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
            <div className="contact-avatar is-large" aria-hidden="true">
              {contact ? (
                <Avatar
                  pictureUrl={pictureUrl}
                  fallback={getInitials(contact.name ?? "")}
                  fallbackClassName="contact-avatar-fallback"
                  loading="lazy"
                />
              ) : (
                <span className="contact-avatar-fallback">⚡️</span>
              )}
            </div>
            <div className="contact-header-text">
              <h3 className="unspaced recurring-truncate">{order.title}</h3>
              <p className="muted unspaced recurring-truncate">{recipient}</p>
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
            <span className="muted">
              {describeRecurringInterval(order.schedule.interval, t)}
            </span>
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
          {row(t("recurringRunsCount"), runsText)}
          {row(
            t("recurringFirstRunLabel"),
            formatDate(order.schedule.anchorAtSec),
          )}
          {order.note ? row(t("recurringNoteLabel"), order.note) : null}
          {row(
            t("recurringDeviceLabel"),
            runsOnThisDevice
              ? t("recurringRunsOnThisDevice")
              : t("recurringRunsOnOtherDevice"),
          )}
          {!runsOnThisDevice ? (
            <p className="muted recurring-hint">
              {t("recurringOtherDeviceHint")}
            </p>
          ) : null}

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
            {!runsOnThisDevice ? (
              <button
                type="button"
                className="btn-wide secondary"
                onClick={() => bindRecurringPaymentToThisDevice(order)}
              >
                {t("recurringBindToThisDevice")}
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
                  navigateTo({ route: "recurringPayments" });
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
        </div>
      </div>
    </section>
  );
}
