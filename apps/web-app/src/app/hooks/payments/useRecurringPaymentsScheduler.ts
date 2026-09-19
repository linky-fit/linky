import * as Evolu from "@evolu/common";
import {
  ClientId,
  MessageText,
  OutboxRef,
  Pubkey,
  TextMessageDraft,
} from "@linky/linkstr";
import { Either, Exit, Schema } from "effect";
import React from "react";
import { reportAppLog } from "../../../devtools/inspector/appLog";
import { evolu, type RecurringPaymentId } from "../../../evolu";
import { useLatest } from "../../../hooks/useLatest";
import type { Translate } from "../../../i18n";
import type { DisplayAmountParts } from "../../../utils/displayAmounts";
import { formatShortNpub } from "../../../utils/formatting";
import { nowSeconds } from "../../../utils/time";
import { makeLocalId } from "../../../utils/validation";
import { getDeviceId } from "../../lib/deviceId";
import {
  readRecurringPaymentOrder,
  type RecurringPaymentOrder,
  type RecurringPaymentRunStatus,
  type RecurringRunRef,
} from "../../lib/recurringPaymentOrder";
import {
  planRecurringPaymentTick,
  RECURRING_NOTICE_SEC,
  RECURRING_RUN_RETRY_DELAY_SEC,
  type RecurringTickAction,
} from "../../lib/recurringPaymentTick";
import {
  nextRecurringOccurrenceAfter,
  resolveTimeZone,
} from "../../lib/recurringSchedule";
import type {
  ContactRowLike,
  NewLocalNostrMessage,
  UpdateLocalNostrMessage,
} from "../../types/appTypes";
import { resolveNostrChatIdentity } from "../messages/contactIdentity";
import type { EnqueueOutbox } from "./publishCashuMessagePayment";

/** Short enough that a payment goes out within seconds of its send time. */
export const RECURRING_TICK_INTERVAL_MS = 15_000;

interface RecurringPaymentPatch {
  readonly claimAtSec?: number;
  readonly claimDeviceId?: string;
  readonly claimDueAtSec?: number;
  readonly lastRunAtSec?: number;
  readonly lastRunStatus?: RecurringPaymentRunStatus;
  readonly nextDueAtSec?: number;
  readonly runCount?: number;
}

/** The slice of Evolu's `update` mutation this hook writes through. */
type UpdateRecurringPayment = (
  table: "recurringPayment",
  payload: RecurringPaymentPatch & { readonly id: RecurringPaymentId },
  options?: { readonly ownerId: Evolu.OwnerId },
) => unknown;

interface PayContactResult {
  ok: boolean;
  error?: string;
}

export type RecurringRunOutcome = "paid" | "failed" | "busy" | "missing";

export interface RecurringPaymentsScheduler {
  /** One scheduler pass over every payment. */
  runNow: () => Promise<void>;
  /**
   * Pay one payment right away, skipping its notice window and consuming its
   * pending period. `busy` means the wallet was occupied and nothing moved.
   */
  runOrderNow: (orderId: string) => Promise<RecurringRunOutcome>;
}

interface UseRecurringPaymentsSchedulerParams {
  appendLocalNostrMessage: (message: NewLocalNostrMessage) => string;
  cashuBalance: number;
  cashuIsBusy: boolean;
  contacts: readonly ContactRowLike[];
  currentNsec: string | null;
  /** Null until the linkstr runtime is composed. */
  enqueueOutbox: EnqueueOutbox | null;
  /** False until the linkshu runtime is composed (seed + owners resolved). */
  enabled: boolean;
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
  setCashuIsBusy: React.Dispatch<React.SetStateAction<boolean>>;
  showPaidOverlay: (title: string) => void;
  t: Translate;
  update: UpdateRecurringPayment;
  updateLocalNostrMessage: UpdateLocalNostrMessage;
  dependencies?: {
    deviceId?: string;
    nowSec?: () => number;
    tickIntervalMs?: number;
  };
}

interface RecurringPaymentRowLike {
  readonly id: RecurringPaymentId;
  readonly ownerId: unknown;
}

type RunAction = Extract<RecurringTickAction, { kind: "run" }>;

const isPubkey = Schema.is(Pubkey);
const decodeMessageText = Schema.decodeUnknownEither(MessageText);

const orderLinks = (order: RecurringPaymentOrder): Record<string, string> => ({
  recurringPayment: order.id,
  contact: order.contactId,
});

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
 * and notifies the user; every device then shows it with a cancel button for
 * the notice window. When the window ends the device named by the claim —
 * Evolu's last writer, the same on every device once synced — pays it through
 * the ordinary contact payment path and shows the usual paid confirmation. The
 * run is marked `running` with the schedule already advanced before money
 * moves, so no other pass or device pays it again; a failure rolls the
 * schedule back for a retry within the grace window.
 */
export const useRecurringPaymentsScheduler = ({
  appendLocalNostrMessage,
  cashuBalance,
  cashuIsBusy,
  contacts,
  currentNsec,
  dependencies,
  enabled,
  enqueueOutbox,
  formatDisplayedAmountParts,
  maybeShowPwaNotification,
  payContactWithCashuMessage,
  payLightningAddressWithCashu,
  payWithCashuEnabled,
  pushToast,
  setCashuIsBusy,
  showPaidOverlay,
  t,
  update,
  updateLocalNostrMessage,
}: UseRecurringPaymentsSchedulerParams): RecurringPaymentsScheduler => {
  const latest = useLatest({
    appendLocalNostrMessage,
    cashuBalance,
    cashuIsBusy,
    contacts,
    currentNsec,
    enabled,
    enqueueOutbox,
    formatDisplayedAmountParts,
    maybeShowPwaNotification,
    payContactWithCashuMessage,
    payLightningAddressWithCashu,
    payWithCashuEnabled,
    pushToast,
    setCashuIsBusy,
    showPaidOverlay,
    t,
    update,
    updateLocalNostrMessage,
  });
  const nowSec = dependencies?.nowSec ?? nowSeconds;
  const deviceId = dependencies?.deviceId ?? getDeviceId();
  const tickIntervalMs =
    dependencies?.tickIntervalMs ?? RECURRING_TICK_INTERVAL_MS;
  const tickInFlightRef = React.useRef<Promise<void> | null>(null);
  const retryNotBeforeRef = React.useRef(new Map<string, number>());
  const reportedWaitsRef = React.useRef(new Set<string>());

  const ordersQuery = React.useMemo(
    () =>
      evolu.createQuery((db) =>
        db
          .selectFrom("recurringPayment")
          .selectAll()
          .where("isDeleted", "is not", Evolu.sqliteTrue),
      ),
    [],
  );

  const loadOrders = React.useCallback(async () => {
    const rows = await evolu.loadQuery(ordersQuery);
    const rowsById = new Map<string, RecurringPaymentRowLike>();
    const orders: RecurringPaymentOrder[] = [];
    for (const row of rows) {
      const order = readRecurringPaymentOrder(row);
      if (order === null) continue;
      rowsById.set(order.id, row);
      orders.push(order);
    }
    return { orders, rowsById };
  }, [ordersQuery]);

  const patchOrder = React.useCallback(
    (row: RecurringPaymentRowLike, patch: RecurringPaymentPatch): void => {
      const ownerId = Evolu.OwnerId.fromUnknown(row.ownerId);
      const payload = { id: row.id, ...patch };
      if (ownerId.ok) {
        latest.current.update("recurringPayment", payload, {
          ownerId: ownerId.value,
        });
      } else {
        latest.current.update("recurringPayment", payload);
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

  const sendChatNote = React.useCallback(
    async (contact: ContactRowLike, text: string): Promise<void> => {
      const { currentNsec: nsec, enqueueOutbox: enqueue } = latest.current;
      if (!nsec || enqueue === null) return;
      const identity = await resolveNostrChatIdentity(nsec, contact);
      if (!identity || !isPubkey(identity.contactPubHex)) return;
      const content = decodeMessageText(text);
      if (Either.isLeft(content)) return;
      const clientId = ClientId.make(makeLocalId());
      const pendingId = latest.current.appendLocalNostrMessage({
        clientId,
        contactId: String(contact.id ?? ""),
        content: text,
        createdAtSec: nowSec(),
        direction: "out",
        pubkey: identity.myPubHex,
        rumorId: null,
        status: "pending",
        wrapId: `pending:${clientId}`,
      });
      if (!pendingId) return;
      const exit = await enqueue({
        op: {
          _tag: "chat.text",
          draft: new TextMessageDraft({
            to: identity.contactPubHex,
            content: content.right,
            clientId,
          }),
        },
        ref: OutboxRef.make(`message:${pendingId}`),
      });
      if (Exit.isSuccess(exit)) {
        latest.current.updateLocalNostrMessage(pendingId, {
          createdAtSec: exit.value.sentAt,
          rumorId: exit.value.rumorId,
        });
      }
    },
    [latest, nowSec],
  );

  const claimOrder = React.useCallback(
    (
      row: RecurringPaymentRowLike,
      action: Extract<RecurringTickAction, { kind: "claim" }>,
    ): void => {
      const { order, dueAtSec, takeover } = action;
      const now = nowSec();
      patchOrder(row, {
        claimDeviceId: deviceId,
        claimAtSec: now,
        claimDueAtSec: dueAtSec,
      });
      const contact = findContact(order.contactId);
      const { amount, unit } = formatAmount(order.amountSat);
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
    [deviceId, findContact, formatAmount, latest, nowSec, patchOrder],
  );

  const settleRun = React.useCallback(
    (
      row: RecurringPaymentRowLike,
      action: RunAction,
      outcome: { ok: true } | { ok: false; error: string },
      startedAtSec: number,
    ): void => {
      const { order } = action;
      if (outcome.ok) {
        patchOrder(row, { lastRunStatus: "paid" });
        const contact = findContact(order.contactId);
        const { amount, unit } = formatAmount(order.amountSat);
        latest.current.showPaidOverlay(
          latest.current
            .t("paidSentTo")
            .replace("{amount}", amount)
            .replace("{unit}", unit)
            .replace("{name}", contact ? contactDisplayName(contact) : ""),
        );
      } else {
        // Back to the due time so the next pass retries; the planner skips
        // the run for good once the grace window closes.
        patchOrder(row, {
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
          amountSat: order.amountSat,
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
    async (
      row: RecurringPaymentRowLike,
      action: RunAction,
    ): Promise<"paid" | "failed"> => {
      const { order, advance, dueAtSec } = action;
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
        patchOrder(row, {
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

      patchOrder(row, {
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
            order.amountSat,
            contact,
            { recurringRun },
          );
        } catch (caught) {
          error = String(caught);
        }
        settleRun(
          row,
          action,
          paid ? { ok: true } : { ok: false, error },
          startedAtSec,
        );
        return paid ? "paid" : "failed";
      }

      latest.current.setCashuIsBusy(true);
      let outcome: { ok: true } | { ok: false; error: string };
      try {
        try {
          await sendChatNote(
            contact,
            latest.current.t("recurringPaymentChatNote"),
          );
        } catch {
          // The note is a courtesy; the payment still goes out.
        }
        const result = await latest.current.payContactWithCashuMessage({
          amountSat: order.amountSat,
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
      settleRun(row, action, outcome, startedAtSec);
      return outcome.ok ? "paid" : "failed";
    },
    [findContact, latest, nowSec, patchOrder, sendChatNote, settleRun],
  );

  const runOrderNow = React.useCallback(
    async (orderId: string): Promise<RecurringRunOutcome> => {
      if (tickInFlightRef.current) await tickInFlightRef.current;
      if (latest.current.cashuIsBusy) return "busy";
      const { orders, rowsById } = await loadOrders();
      const order = orders.find((candidate) => candidate.id === orderId);
      const row = rowsById.get(orderId);
      if (!order || !row) return "missing";
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
      patchOrder(row, {
        claimDeviceId: deviceId,
        claimAtSec: now,
        claimDueAtSec: schedule.nextDueAtSec,
      });
      const pass = executeRun(row, {
        kind: "run",
        order,
        dueAtSec: schedule.nextDueAtSec,
        missedCount: 0,
        advance: {
          nextDueAtSec: next.dueAtSec,
          runCount: schedule.runCount + 1,
        },
      }).finally(() => {
        tickInFlightRef.current = null;
      });
      tickInFlightRef.current = pass.then(() => undefined);
      return pass;
    },
    [deviceId, executeRun, latest, loadOrders, nowSec, patchOrder],
  );

  const tick = React.useCallback(async (): Promise<void> => {
    if (tickInFlightRef.current) return tickInFlightRef.current;
    if (!latest.current.enabled) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;

    const pass = (async () => {
      const { orders, rowsById } = await loadOrders();
      if (orders.length === 0) return;

      const now = nowSec();
      const actions = planRecurringPaymentTick({
        orders,
        nowSec: now,
        deviceId,
        cashuBalance: latest.current.cashuBalance,
        retryNotBeforeSec: retryNotBeforeRef.current,
      });

      for (const action of actions) {
        const row = rowsById.get(action.order.id);
        if (!row) continue;
        switch (action.kind) {
          case "claim":
            claimOrder(row, action);
            break;
          case "markInterrupted":
            patchOrder(row, { lastRunStatus: "interrupted" });
            reportAppLog({
              tag: "recurring.interrupted",
              summary: "recurring payment run did not finish",
              links: orderLinks(action.order),
              payload: { lastRunAtSec: action.order.lastRunAtSec },
            });
            break;
          case "skip":
            patchOrder(row, {
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
          case "waitFunds": {
            const key = `${action.order.id}:${action.dueAtSec}`;
            if (reportedWaitsRef.current.has(key)) break;
            reportedWaitsRef.current.add(key);
            latest.current.pushToast(
              latest.current.t("recurringWaitingForFunds"),
            );
            reportAppLog({
              tag: "recurring.waitingForFunds",
              summary: "recurring payment waits for funds",
              links: orderLinks(action.order),
              payload: {
                amountSat: action.order.amountSat,
                balanceSat: latest.current.cashuBalance,
                dueAtSec: action.dueAtSec,
              },
            });
            break;
          }
          case "run":
            // The wallet serializes payments; a busy wallet means the next
            // pass picks this run up.
            if (latest.current.cashuIsBusy) return;
            await executeRun(row, action);
            break;
        }
      }
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
    claimOrder,
    deviceId,
    executeRun,
    latest,
    loadOrders,
    nowSec,
    patchOrder,
  ]);

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

  return { runNow: tick, runOrderNow };
};
