import type {
  RecurringPaymentId,
  RecurringPaymentsRepository,
  TransactionsRepository,
} from "@linky-fit/linksync";
import { Effect } from "effect";
import React from "react";
import { reportAppLog } from "../../../devtools/inspector/appLog";
import { useLatest } from "../../../hooks/useLatest";
import type { Translate } from "../../../i18n";
import type {
  DisplayAmountParts,
  FiatRates,
} from "../../../utils/displayAmounts";
import { formatShortNpub } from "../../../utils/formatting";
import { nowSeconds } from "../../../utils/time";
import { getDeviceId } from "../../lib/deviceId";
import {
  paidOverlayContact,
  type PaidOverlayDetails,
} from "../../lib/paidOverlay";
import { recurringAmountSat } from "../../lib/recurringAmount";
import {
  readRecurringPaymentOrder,
  recurringRunRecorded,
  type RecurringPaymentOrder,
  type RecurringRunRef,
} from "../../lib/recurringPaymentOrder";
import {
  planRecurringPaymentTick,
  RECURRING_CONFIRM_SEC,
  RECURRING_NOTICE_SEC,
  RECURRING_RUN_RETRY_DELAY_SEC,
  type RecurringTickAction,
} from "../../lib/recurringPaymentTick";
import {
  recurringPaymentPatch,
  type RecurringPaymentPatchInput,
} from "../../lib/recurringPaymentWrite";
import {
  advanceRecurringSchedule,
  nextRecurringOccurrenceAfter,
  resolveTimeZone,
} from "../../lib/recurringSchedule";
import { runWrite } from "../../lib/storeWrite";
import type { ContactRowLike } from "../../types/appTypes";

/** Short enough that a payment goes out within seconds of its send time. */
export const RECURRING_TICK_INTERVAL_MS = 15_000;

interface PayContactResult {
  ok: boolean;
  error?: string;
}

export type RecurringRunOutcome = "paid" | "failed" | "busy" | "missing";

/** A due payment waiting for the in-app countdown to end (or the user to decide). */
export interface RecurringDueConfirmation {
  orderId: RecurringPaymentId;
  dueAtSec: number;
  amountSat: number;
  /** When the countdown ends and the payment goes out on its own. */
  sendAtSec: number;
}

export interface RecurringPaymentsScheduler {
  /** One scheduler pass over every payment. */
  runNow: () => Promise<void>;
  /**
   * Pay one payment right away, skipping its notice window and consuming its
   * pending period. `busy` means the wallet was occupied and nothing moved.
   */
  runOrderNow: (orderId: RecurringPaymentId) => Promise<RecurringRunOutcome>;
  dueConfirmation: RecurringDueConfirmation | null;
  /** Pay the confirmed-due payment now instead of waiting the countdown out. */
  confirmDueNow: () => Promise<void>;
  /** Skip the confirmed-due payment's period; the schedule moves to the next due time. */
  cancelDue: () => Promise<void>;
}

interface UseRecurringPaymentsSchedulerParams {
  cashuBalance: number;
  cashuIsBusy: boolean;
  contacts: readonly ContactRowLike[];
  /** False until the linkshu runtime is composed (seed + owners resolved). */
  enabled: boolean;
  fiatRates: FiatRates | null;
  formatDisplayedAmountParts: (amountSat: number) => DisplayAmountParts;
  maybeShowPwaNotification: (
    title: string,
    body: string,
    tag?: string,
  ) => Promise<void>;
  payContactWithCashuMessage: (args: {
    amountSat: number;
    contact: ContactRowLike;
    fromQueue?: boolean;
    recurringRun?: RecurringRunRef | null;
  }) => Promise<PayContactResult>;
  payLightningAddressWithCashu: (
    lnAddress: string,
    amountSat: number,
    contact: ContactRowLike,
    options?: { recurringRun?: RecurringRunRef | null },
  ) => Promise<boolean>;
  payWithCashuEnabled: boolean;
  pushToast: (message: string) => void;
  repository: RecurringPaymentsRepository;
  setCashuIsBusy: React.Dispatch<React.SetStateAction<boolean>>;
  showPaidOverlay: (title: string, details: PaidOverlayDetails) => void;
  t: Translate;
  /** The history decides whether an interrupted run had already moved money. */
  transactions: Pick<TransactionsRepository, "all">;
  dependencies?: {
    deviceId?: string;
    /** Whether the user is looking at Linky; a visible app asks before paying. */
    isVisible?: () => boolean;
    nowSec?: () => number;
    tickIntervalMs?: number;
  };
}

type RunAction = Extract<RecurringTickAction, { kind: "run" }>;

const orderLinks = (order: RecurringPaymentOrder): Record<string, string> => ({
  recurringPayment: order.id,
  contact: order.contactId,
});

const documentIsVisible = (): boolean =>
  typeof document === "undefined" || document.visibilityState === "visible";

export const contactDisplayName = (contact: ContactRowLike): string => {
  const npub = String(contact.npub ?? "").trim();
  return (
    String(contact.name ?? "").trim() ||
    String(contact.lnAddress ?? "").trim() ||
    (npub ? formatShortNpub(npub) : "")
  );
};

/**
 * Runs recurring payments on whichever device is online. Before a payment is
 * due (or as soon as an overdue one is noticed) a device claims it on the row
 * and notifies the user. When the notice window ends the device named by the
 * claim (Evolu's last writer, the same on every device once synced) pays it:
 * silently when Linky is in the background, after a short in-app countdown
 * with pay-now and cancel when it is visible. The run is marked `running` with
 * the schedule already advanced before money moves, so no other pass or device
 * pays it again; a failure rolls the schedule back for a retry within the
 * grace window.
 */
export const useRecurringPaymentsScheduler = ({
  cashuBalance,
  cashuIsBusy,
  contacts,
  dependencies,
  enabled,
  fiatRates,
  formatDisplayedAmountParts,
  maybeShowPwaNotification,
  payContactWithCashuMessage,
  payLightningAddressWithCashu,
  payWithCashuEnabled,
  pushToast,
  repository,
  setCashuIsBusy,
  showPaidOverlay,
  t,
  transactions,
}: UseRecurringPaymentsSchedulerParams): RecurringPaymentsScheduler => {
  const latest = useLatest({
    cashuBalance,
    cashuIsBusy,
    contacts,
    enabled,
    fiatRates,
    formatDisplayedAmountParts,
    maybeShowPwaNotification,
    payContactWithCashuMessage,
    payLightningAddressWithCashu,
    payWithCashuEnabled,
    pushToast,
    repository,
    setCashuIsBusy,
    showPaidOverlay,
    t,
    transactions,
  });
  const nowSec = dependencies?.nowSec ?? nowSeconds;
  const isVisible = dependencies?.isVisible ?? documentIsVisible;
  const deviceId = dependencies?.deviceId ?? getDeviceId();
  const tickIntervalMs =
    dependencies?.tickIntervalMs ?? RECURRING_TICK_INTERVAL_MS;
  const tickInFlightRef = React.useRef<Promise<void> | null>(null);
  const retryNotBeforeRef = React.useRef(new Map<string, number>());
  const reportedWaitsRef = React.useRef(new Set<string>());
  const [dueConfirmation, setDueConfirmation] =
    React.useState<RecurringDueConfirmation | null>(null);
  const dueConfirmationRef = useLatest(dueConfirmation);

  const loadOrders = React.useCallback(async () => {
    const records = await Effect.runPromise(latest.current.repository.all);
    return records.flatMap((record) => {
      const order = readRecurringPaymentOrder(record);
      return order === null ? [] : [order];
    });
  }, [latest]);

  const patchOrder = React.useCallback(
    async (
      order: RecurringPaymentOrder,
      patch: RecurringPaymentPatchInput,
    ): Promise<void> => {
      const outcome = await runWrite(
        latest.current.repository.update(
          order.id,
          recurringPaymentPatch(patch),
        ),
      );
      if (!outcome.ok) {
        console.warn("[linky][recurring] row update failed", outcome.error);
      }
    },
    [latest],
  );

  const findContact = React.useCallback(
    (contactId: string): ContactRowLike | undefined =>
      latest.current.contacts.find(
        (candidate) => (candidate.id ?? "") === contactId,
      ),
    [latest],
  );

  const formatAmount = React.useCallback(
    (amountSat: number) => {
      const parts = latest.current.formatDisplayedAmountParts(amountSat);
      return {
        amount: `${parts.approxPrefix}${parts.amountText}`,
        unit: parts.unitLabel,
      };
    },
    [latest],
  );

  const amountSatOf = React.useCallback(
    (order: RecurringPaymentOrder): number | null =>
      recurringAmountSat(order.amount, latest.current.fiatRates),
    [latest],
  );

  /**
   * A run that never finished (Linky was killed mid-payment) has its schedule
   * already advanced. If the history holds no transaction for that due time
   * the money never moved, so the due time is restored and the payment goes
   * out on a later pass instead of silently disappearing.
   */
  const settleInterruptedRun = React.useCallback(
    async (order: RecurringPaymentOrder): Promise<void> => {
      const dueAtSec = order.claim?.dueAtSec ?? null;
      const recorded =
        dueAtSec === null
          ? null
          : recurringRunRecorded(
              await Effect.runPromise(latest.current.transactions.all),
              { recurringPaymentId: order.id, dueAtSec },
            );
      if (recorded === true) {
        await patchOrder(order, { lastRunStatus: "paid" });
      } else if (dueAtSec !== null && recorded === false) {
        await patchOrder(order, {
          lastRunStatus: "interrupted",
          nextDueAtSec: dueAtSec,
          runCount: Math.max(0, order.schedule.runCount - 1),
        });
      } else {
        await patchOrder(order, { lastRunStatus: "interrupted" });
      }
      reportAppLog({
        tag: "recurring.interrupted",
        summary:
          recorded === true
            ? "recurring payment run did not finish but its payment is recorded"
            : "recurring payment run did not finish; due time restored",
        links: orderLinks(order),
        payload: {
          dueAtSec,
          lastRunAtSec: order.lastRunAtSec,
          recorded,
        },
      });
    },
    [latest, patchOrder],
  );

  const claimOrder = React.useCallback(
    async (
      action: Extract<RecurringTickAction, { kind: "claim" }>,
    ): Promise<void> => {
      const { order, dueAtSec, takeover } = action;
      const now = nowSec();
      await patchOrder(order, {
        claimDeviceId: deviceId,
        claimAtSec: now,
        claimDueAtSec: dueAtSec,
      });
      const contact = findContact(order.contactId);
      const amountSat = amountSatOf(order);
      const { amount, unit } = formatAmount(amountSat ?? 0);
      const minutes = Math.max(
        1,
        Math.ceil((Math.max(dueAtSec, now + RECURRING_NOTICE_SEC) - now) / 60),
      );
      void latest.current
        .maybeShowPwaNotification(
          latest.current.t("recurringPaymentTitle"),
          latest.current
            .t("recurringNotifyBody")
            .replace("{amount}", amount)
            .replace("{unit}", unit)
            .replace("{name}", contact ? contactDisplayName(contact) : "")
            .replace("{minutes}", String(minutes)),
          `recurring:${order.id}:${dueAtSec}`,
        )
        .catch(() => undefined);
      reportAppLog({
        tag: "recurring.claimed",
        summary: `recurring payment claimed${takeover ? " (takeover)" : ""}`,
        links: orderLinks(order),
        payload: {
          deviceId,
          dueAtSec,
          previousClaim: order.claim,
          takeover,
        },
      });
    },
    [
      amountSatOf,
      deviceId,
      findContact,
      formatAmount,
      latest,
      nowSec,
      patchOrder,
    ],
  );

  const settleRun = React.useCallback(
    async (
      action: RunAction,
      outcome: { ok: true } | { ok: false; error: string },
      startedAtSec: number,
    ): Promise<void> => {
      const { order } = action;
      if (outcome.ok) {
        await patchOrder(order, { lastRunStatus: "paid" });
        const contact = findContact(order.contactId);
        const { amount, unit } = formatAmount(action.amountSat);
        const name = contact ? contactDisplayName(contact) : "";
        latest.current.showPaidOverlay(
          latest.current
            .t("paidSentTo")
            .replace("{amount}", amount)
            .replace("{unit}", unit)
            .replace("{name}", name),
          {
            direction: "out",
            amountSat: action.amountSat,
            contact: paidOverlayContact(contact),
          },
        );
        void latest.current
          .maybeShowPwaNotification(
            latest.current.t("recurringPaymentTitle"),
            latest.current
              .t("recurringSentBody")
              .replace("{amount}", amount)
              .replace("{unit}", unit)
              .replace("{name}", name),
            `recurring-sent:${order.id}:${action.dueAtSec}`,
          )
          .catch(() => undefined);
      } else {
        // Back to the due time so the next pass retries; the planner skips
        // the run for good once the grace window closes.
        await patchOrder(order, {
          lastRunStatus: "failed",
          nextDueAtSec: order.schedule.nextDueAtSec,
          runCount: order.schedule.runCount,
        });
        retryNotBeforeRef.current.set(
          order.id,
          startedAtSec + RECURRING_RUN_RETRY_DELAY_SEC,
        );
        latest.current.pushToast(latest.current.t("recurringRunFailedToast"));
      }
      reportAppLog({
        tag: "recurring.run",
        summary: outcome.ok
          ? "recurring payment paid"
          : "recurring payment failed",
        links: orderLinks(order),
        payload: {
          amount: order.amount,
          amountSat: action.amountSat,
          dueAtSec: action.dueAtSec,
          missedCount: action.missedCount,
          status: outcome.ok ? "paid" : "failed",
          ...(outcome.ok ? {} : { error: outcome.error }),
        },
      });
    },
    [findContact, formatAmount, latest, patchOrder],
  );

  const executeRun = React.useCallback(
    async (action: RunAction): Promise<"paid" | "failed"> => {
      const { order, advance, amountSat, dueAtSec } = action;
      const startedAtSec = nowSec();
      const recurringRun: RecurringRunRef = {
        recurringPaymentId: order.id,
        dueAtSec,
      };
      const contact = findContact(order.contactId);
      const npub = String(contact?.npub ?? "").trim();
      const lnAddress = String(contact?.lnAddress ?? "").trim();
      const rail =
        contact === undefined
          ? null
          : latest.current.payWithCashuEnabled && npub
            ? "cashu"
            : lnAddress
              ? "lightning"
              : null;

      if (contact === undefined || rail === null) {
        await patchOrder(order, {
          lastRunAtSec: startedAtSec,
          lastRunStatus: "skipped",
          nextDueAtSec: advance.nextDueAtSec,
          runCount: advance.runCount,
        });
        latest.current.pushToast(
          latest.current.t("recurringRecipientUnavailable"),
        );
        reportAppLog({
          tag: "recurring.skipped",
          summary: "recurring payment skipped (recipient cannot be paid)",
          links: orderLinks(order),
          payload: { dueAtSec, reason: "invalidRecipient" },
        });
        return "failed";
      }

      await patchOrder(order, {
        lastRunAtSec: startedAtSec,
        lastRunStatus: "running",
        nextDueAtSec: advance.nextDueAtSec,
        runCount: advance.runCount,
      });

      if (rail === "lightning") {
        // The Lightning path manages the wallet's busy flag itself.
        let paid = false;
        let error = "lightning payment failed";
        try {
          paid = await latest.current.payLightningAddressWithCashu(
            lnAddress,
            amountSat,
            contact,
            { recurringRun },
          );
        } catch (caught) {
          error = String(caught);
        }
        await settleRun(
          action,
          paid ? { ok: true } : { ok: false, error },
          startedAtSec,
        );
        return paid ? "paid" : "failed";
      }

      latest.current.setCashuIsBusy(true);
      let outcome: { ok: true } | { ok: false; error: string };
      try {
        const result = await latest.current.payContactWithCashuMessage({
          amountSat,
          contact,
          fromQueue: true,
          recurringRun,
        });
        outcome = result.ok
          ? { ok: true }
          : { ok: false, error: result.error ?? "unknown" };
      } catch (error) {
        outcome = { ok: false, error: String(error) };
      } finally {
        latest.current.setCashuIsBusy(false);
      }
      await settleRun(action, outcome, startedAtSec);
      return outcome.ok ? "paid" : "failed";
    },
    [findContact, latest, nowSec, patchOrder, settleRun],
  );

  const runOrderNow = React.useCallback(
    async (orderId: RecurringPaymentId): Promise<RecurringRunOutcome> => {
      if (tickInFlightRef.current) await tickInFlightRef.current;
      if (latest.current.cashuIsBusy) return "busy";
      const orders = await loadOrders();
      const order = orders.find((candidate) => candidate.id === orderId);
      if (!order) return "missing";
      const amountSat = amountSatOf(order);
      if (amountSat === null) {
        latest.current.pushToast(latest.current.t("recurringWaitingForRates"));
        return "failed";
      }
      const now = nowSec();
      // Paying early consumes the pending period: the next due time is the
      // first one after whichever is later, now or the pending due time.
      const { schedule } = order;
      const next = nextRecurringOccurrenceAfter(
        schedule.anchorAtSec,
        schedule.interval,
        Math.max(now, schedule.nextDueAtSec),
        resolveTimeZone(schedule.timeZone),
      );
      setDueConfirmation((current) =>
        current?.orderId === orderId ? null : current,
      );
      const pass = (async () => {
        await patchOrder(order, {
          claimDeviceId: deviceId,
          claimAtSec: now,
          claimDueAtSec: schedule.nextDueAtSec,
        });
        return executeRun({
          kind: "run",
          order,
          amountSat,
          dueAtSec: schedule.nextDueAtSec,
          missedCount: 0,
          advance: {
            nextDueAtSec: next.dueAtSec,
            runCount: schedule.runCount + 1,
          },
        });
      })().finally(() => {
        tickInFlightRef.current = null;
      });
      tickInFlightRef.current = pass.then(() => undefined);
      return pass;
    },
    [amountSatOf, deviceId, executeRun, latest, loadOrders, nowSec, patchOrder],
  );

  const tick = React.useCallback(async (): Promise<void> => {
    if (tickInFlightRef.current) return tickInFlightRef.current;
    if (!latest.current.enabled) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;

    const pass = (async () => {
      const orders = await loadOrders();
      const now = nowSec();
      const actions = planRecurringPaymentTick({
        orders,
        nowSec: now,
        deviceId,
        cashuBalance: latest.current.cashuBalance,
        amountSatOf,
        retryNotBeforeSec: retryNotBeforeRef.current,
      });
      let awaitingConfirmation: RecurringDueConfirmation | null = null;

      for (const action of actions) {
        switch (action.kind) {
          case "claim":
            await claimOrder(action);
            break;
          case "markInterrupted":
            await settleInterruptedRun(action.order);
            break;
          case "skip":
            await patchOrder(action.order, {
              lastRunAtSec: now,
              lastRunStatus: "skipped",
              nextDueAtSec: action.advance.nextDueAtSec,
              runCount: action.advance.runCount,
            });
            reportAppLog({
              tag: "recurring.skipped",
              summary: `recurring payment skipped (${action.reason})`,
              links: orderLinks(action.order),
              payload: { dueAtSec: action.dueAtSec, reason: action.reason },
            });
            break;
          case "waitFunds":
          case "waitRates": {
            const key = `${action.kind}:${action.order.id}:${action.dueAtSec}`;
            if (reportedWaitsRef.current.has(key)) break;
            reportedWaitsRef.current.add(key);
            latest.current.pushToast(
              latest.current.t(
                action.kind === "waitFunds"
                  ? "recurringWaitingForFunds"
                  : "recurringWaitingForRates",
              ),
            );
            reportAppLog({
              tag:
                action.kind === "waitFunds"
                  ? "recurring.waitingForFunds"
                  : "recurring.waitingForRates",
              summary:
                action.kind === "waitFunds"
                  ? "recurring payment waits for funds"
                  : "recurring payment waits for an exchange rate",
              links: orderLinks(action.order),
              payload: {
                amount: action.order.amount,
                balanceSat: latest.current.cashuBalance,
                dueAtSec: action.dueAtSec,
              },
            });
            break;
          }
          case "run": {
            // The wallet serializes payments; a busy wallet means the next
            // pass picks this run up.
            if (latest.current.cashuIsBusy) return;
            if (isVisible()) {
              // The user is looking at Linky: show the countdown instead of
              // paying silently. One payment at a time; the rest follow.
              const current = dueConfirmationRef.current;
              awaitingConfirmation =
                current?.orderId === action.order.id &&
                current.dueAtSec === action.dueAtSec
                  ? current
                  : {
                      orderId: action.order.id,
                      dueAtSec: action.dueAtSec,
                      amountSat: action.amountSat,
                      sendAtSec: now + RECURRING_CONFIRM_SEC,
                    };
              if (awaitingConfirmation !== current) {
                reportAppLog({
                  tag: "recurring.confirmationShown",
                  summary: "recurring payment countdown shown",
                  links: orderLinks(action.order),
                  payload: {
                    amountSat: action.amountSat,
                    dueAtSec: action.dueAtSec,
                    sendAtSec: awaitingConfirmation.sendAtSec,
                  },
                });
              }
              setDueConfirmation(awaitingConfirmation);
              return;
            }
            await executeRun(action);
            break;
          }
        }
      }
      if (awaitingConfirmation === null) setDueConfirmation(null);
    })()
      .catch((error: unknown) => {
        console.warn("[linky][recurring] scheduler tick failed", error);
      })
      .finally(() => {
        tickInFlightRef.current = null;
      });
    tickInFlightRef.current = pass;
    return pass;
  }, [
    amountSatOf,
    claimOrder,
    deviceId,
    dueConfirmationRef,
    executeRun,
    isVisible,
    latest,
    loadOrders,
    nowSec,
    patchOrder,
    settleInterruptedRun,
  ]);

  const confirmDueNow = React.useCallback(async (): Promise<void> => {
    const pending = dueConfirmationRef.current;
    if (pending === null) return;
    setDueConfirmation(null);
    const outcome = await runOrderNow(pending.orderId);
    if (outcome === "busy") {
      latest.current.pushToast(latest.current.t("recurringWalletBusy"));
    }
  }, [dueConfirmationRef, latest, runOrderNow]);

  const cancelDue = React.useCallback(async (): Promise<void> => {
    const pending = dueConfirmationRef.current;
    if (pending === null) return;
    setDueConfirmation(null);
    if (tickInFlightRef.current) await tickInFlightRef.current;
    const orders = await loadOrders();
    const order = orders.find((candidate) => candidate.id === pending.orderId);
    if (!order) return;
    const now = nowSec();
    const advance = advanceRecurringSchedule(order.schedule, now);
    await patchOrder(order, {
      lastRunAtSec: now,
      lastRunStatus: "skipped",
      nextDueAtSec: advance.nextDueAtSec,
      runCount: advance.runCount,
    });
    latest.current.pushToast(latest.current.t("recurringCancelledToast"));
    reportAppLog({
      tag: "recurring.skipped",
      summary: "recurring payment skipped (cancelled by the user)",
      links: orderLinks(order),
      payload: {
        dueAtSec: pending.dueAtSec,
        nextDueAtSec: advance.nextDueAtSec,
        reason: "cancelled",
      },
    });
  }, [dueConfirmationRef, latest, loadOrders, nowSec, patchOrder]);

  React.useEffect(() => {
    if (!enabled) return;
    void tick();
    const interval = window.setInterval(() => void tick(), tickIntervalMs);
    const onOnline = () => void tick();
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, tick, tickIntervalMs]);

  return {
    runNow: tick,
    runOrderNow,
    dueConfirmation,
    confirmDueNow,
    cancelDue,
  };
};
