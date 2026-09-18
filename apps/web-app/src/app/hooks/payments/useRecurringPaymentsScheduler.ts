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

export const RECURRING_TICK_INTERVAL_MS = 60_000;

interface RecurringPaymentPatch {
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

export interface RecurringPaymentsScheduler {
  /** One scheduler pass over every order. */
  runNow: () => Promise<void>;
  /**
   * Pay one order right away, consuming its pending period. Resolves to what
   * happened so the caller can tell the user; `busy` means the wallet was
   * occupied and nothing was attempted.
   */
  runOrderNow: (
    orderId: string,
  ) => Promise<"paid" | "failed" | "busy" | "missing">;
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
  payContactWithCashuMessage: (args: {
    amountSat: number;
    contact: ContactRowLike;
    fromQueue?: boolean;
    recurringRun?: RecurringRunRef | null;
  }) => Promise<PayContactResult>;
  payLightningAddressWithCashu: (
    lnAddress: string,
    amountSat: number,
    options?: { recurringRun?: RecurringRunRef | null },
  ) => Promise<boolean>;
  setCashuIsBusy: React.Dispatch<React.SetStateAction<boolean>>;
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

const isPubkey = Schema.is(Pubkey);
const decodeMessageText = Schema.decodeUnknownEither(MessageText);

const orderLinks = (order: RecurringPaymentOrder): Record<string, string> => ({
  recurringPayment: order.id,
  ...(order.recipient.kind === "contact"
    ? { contact: order.recipient.contactId }
    : {}),
});

/**
 * Runs standing orders while Linky is open: every minute, on launch, when
 * the tab becomes visible, and when the browser comes back online it loads
 * the `recurringPayment` rows, asks the pure tick planner what is due, and
 * pays through the same contact / Lightning-address paths a tap would use,
 * without navigation or overlays. A run is claimed on its row (`running`,
 * schedule advanced) before any money moves, so a second pass or a second
 * device that syncs the row does not pay it again; a failed run rolls the
 * schedule back to retry within the grace window.
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
  payContactWithCashuMessage,
  payLightningAddressWithCashu,
  setCashuIsBusy,
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
    payContactWithCashuMessage,
    payLightningAddressWithCashu,
    setCashuIsBusy,
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

  const settleRun = React.useCallback(
    (
      row: RecurringPaymentRowLike,
      action: Extract<RecurringTickAction, { kind: "run" }>,
      outcome: { ok: true } | { ok: false; error: string },
      startedAtSec: number,
    ): void => {
      const { order } = action;
      if (outcome.ok) {
        patchOrder(row, { lastRunStatus: "paid" });
      } else {
        // Back to the due time so the next tick retries; the planner skips
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
      }
      reportAppLog({
        tag: "recurring.run",
        summary: outcome.ok
          ? `standing order paid: ${order.title}`
          : `standing order failed: ${order.title}`,
        links: orderLinks(order),
        payload: {
          amountSat: order.amountSat,
          dueAtSec: action.dueAtSec,
          missedCount: action.missedCount,
          recipient: order.recipient,
          status: outcome.ok ? "paid" : "failed",
          ...(outcome.ok ? {} : { error: outcome.error }),
        },
      });
    },
    [patchOrder],
  );

  const executeRun = React.useCallback(
    async (
      row: RecurringPaymentRowLike,
      action: Extract<RecurringTickAction, { kind: "run" }>,
    ): Promise<"paid" | "failed"> => {
      const { order, advance, dueAtSec } = action;
      const startedAtSec = nowSec();
      const recurringRun: RecurringRunRef = {
        recurringPaymentId: order.id,
        dueAtSec,
      };

      if (order.recipient.kind === "contact") {
        const contactId = order.recipient.contactId;
        const contact = latest.current.contacts.find(
          (candidate) => (candidate.id ?? "") === contactId,
        );
        if (!contact) {
          patchOrder(row, {
            lastRunAtSec: startedAtSec,
            lastRunStatus: "skipped",
            nextDueAtSec: advance.nextDueAtSec,
            runCount: advance.runCount,
          });
          reportAppLog({
            tag: "recurring.skipped",
            summary: `standing order skipped (contact missing): ${order.title}`,
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
        latest.current.setCashuIsBusy(true);
        let outcome: { ok: true } | { ok: false; error: string };
        try {
          try {
            await sendChatNote(
              contact,
              latest.current
                .t("recurringPaymentChatNote")
                .replace("{title}", order.title),
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
      }

      patchOrder(row, {
        lastRunAtSec: startedAtSec,
        lastRunStatus: "running",
        nextDueAtSec: advance.nextDueAtSec,
        runCount: advance.runCount,
      });
      let paid = false;
      let error = "lightning payment failed";
      try {
        paid = await latest.current.payLightningAddressWithCashu(
          order.recipient.lnAddress,
          order.amountSat,
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
    },
    [latest, nowSec, patchOrder, sendChatNote, settleRun],
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

  const runOrderNow = React.useCallback(
    async (orderId: string) => {
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
      const pass = executeRun(row, {
        kind: "run",
        order,
        dueAtSec: now,
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
    [executeRun, latest, loadOrders, nowSec],
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
          case "markInterrupted":
            patchOrder(row, { lastRunStatus: "interrupted" });
            reportAppLog({
              tag: "recurring.interrupted",
              summary: `standing order run did not finish: ${action.order.title}`,
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
              summary: `standing order skipped (${action.reason}): ${action.order.title}`,
              links: orderLinks(action.order),
              payload: { dueAtSec: action.dueAtSec, reason: action.reason },
            });
            break;
          case "waitFunds": {
            const key = `${action.order.id}:${action.dueAtSec}`;
            if (reportedWaitsRef.current.has(key)) break;
            reportedWaitsRef.current.add(key);
            reportAppLog({
              tag: "recurring.waitingForFunds",
              summary: `standing order waits for funds: ${action.order.title}`,
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
            // tick picks this run up.
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
  }, [deviceId, executeRun, latest, loadOrders, nowSec, patchOrder]);

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
