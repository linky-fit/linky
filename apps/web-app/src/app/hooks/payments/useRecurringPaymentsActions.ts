import * as Evolu from "@evolu/common";
import React from "react";
import { reportAppLog } from "../../../devtools/inspector/appLog";
import { ContactId, RecurringPaymentId } from "../../../evoluIds";
import type { Translate } from "../../../i18n";
import { nowSeconds } from "../../../utils/time";
import type { RecurringPaymentOrder } from "../../lib/recurringPaymentOrder";
import {
  currentTimeZone,
  nextRecurringOccurrenceAfter,
  resolveTimeZone,
  type RecurringInterval,
} from "../../lib/recurringSchedule";
import type { RecurringPaymentsScheduler } from "./useRecurringPaymentsScheduler";

type EvoluMutations = ReturnType<typeof import("../../../evolu").useEvolu>;

export interface NewRecurringPaymentInput {
  amountSat: number;
  contactId: string;
  firstDueAtSec: number;
  interval: RecurringInterval;
  maxRuns: number | null;
}

export interface RecurringPaymentsActions {
  createRecurringPayment: (input: NewRecurringPaymentInput) => boolean;
  pendingRecurringPaymentDeleteId: string | null;
  requestDeleteRecurringPayment: (order: RecurringPaymentOrder) => boolean;
  runRecurringPaymentNow: (order: RecurringPaymentOrder) => Promise<void>;
  setRecurringPaymentPaused: (
    order: RecurringPaymentOrder,
    paused: boolean,
  ) => void;
  skipNextRecurringPayment: (order: RecurringPaymentOrder) => void;
}

interface UseRecurringPaymentsActionsParams {
  insert: EvoluMutations["insert"];
  pushToast: (message: string) => void;
  runOrderNow: RecurringPaymentsScheduler["runOrderNow"];
  t: Translate;
  transactionsOwnerId: Evolu.OwnerId | null;
  update: EvoluMutations["update"];
}

const DELETE_ARM_MS = 5000;

const orderKeys = (
  order: RecurringPaymentOrder,
): {
  id: RecurringPaymentId;
  options: { ownerId: Evolu.OwnerId } | undefined;
} | null => {
  const id = RecurringPaymentId.fromUnknown(order.id);
  if (!id.ok) return null;
  const ownerId = Evolu.OwnerId.fromUnknown(order.ownerId);
  return {
    id: id.value,
    options: ownerId.ok ? { ownerId: ownerId.value } : undefined,
  };
};

/** First due time strictly after `afterSec` on the payment's own grid. */
const nextDueAfter = (order: RecurringPaymentOrder, afterSec: number) =>
  nextRecurringOccurrenceAfter(
    order.schedule.anchorAtSec,
    order.schedule.interval,
    afterSec,
    resolveTimeZone(order.schedule.timeZone),
  ).dueAtSec;

/**
 * User-facing mutations on recurring payments. Inserts go to the active
 * transactions lane; updates target the row's own lane, like every other
 * lane-routed table. Deleting is a two-tap armed action.
 */
export const useRecurringPaymentsActions = ({
  insert,
  pushToast,
  runOrderNow,
  t,
  transactionsOwnerId,
  update,
}: UseRecurringPaymentsActionsParams): RecurringPaymentsActions => {
  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(
    null,
  );

  React.useEffect(() => {
    if (pendingDeleteId === null) return;
    const timeout = window.setTimeout(
      () => setPendingDeleteId(null),
      DELETE_ARM_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [pendingDeleteId]);

  const createRecurringPayment = React.useCallback(
    (input: NewRecurringPaymentInput): boolean => {
      const contactId = ContactId.fromUnknown(input.contactId);
      if (!contactId.ok) return false;
      const payload = {
        createdAtSec: nowSeconds(),
        contactId: contactId.value,
        amountSat: input.amountSat,
        intervalUnit: input.interval.unit,
        intervalCount: input.interval.count,
        anchorAtSec: input.firstDueAtSec,
        timeZone: currentTimeZone(),
        nextDueAtSec: input.firstDueAtSec,
        runCount: 0,
        ...(input.maxRuns !== null ? { maxRuns: input.maxRuns } : {}),
      };
      const result = transactionsOwnerId
        ? insert("recurringPayment", payload, { ownerId: transactionsOwnerId })
        : insert("recurringPayment", payload);
      if (!result.ok) return false;
      reportAppLog({
        tag: "recurring.created",
        summary: "recurring payment created",
        links: {
          recurringPayment: result.value.id,
          contact: input.contactId,
        },
        payload: {
          amountSat: input.amountSat,
          firstDueAtSec: input.firstDueAtSec,
          interval: input.interval,
          maxRuns: input.maxRuns,
        },
      });
      return true;
    },
    [insert, transactionsOwnerId],
  );

  const setRecurringPaymentPaused = React.useCallback(
    (order: RecurringPaymentOrder, paused: boolean): void => {
      const keys = orderKeys(order);
      if (!keys) return;
      const now = nowSeconds();
      if (paused) {
        update(
          "recurringPayment",
          { id: keys.id, pausedAtSec: now },
          keys.options,
        );
      } else {
        // Periods that passed while paused are not paid retroactively.
        const nextDueAtSec =
          order.schedule.nextDueAtSec > now
            ? order.schedule.nextDueAtSec
            : nextDueAfter(order, now);
        update(
          "recurringPayment",
          { id: keys.id, pausedAtSec: null, nextDueAtSec },
          keys.options,
        );
      }
      reportAppLog({
        tag: paused ? "recurring.paused" : "recurring.resumed",
        summary: `recurring payment ${paused ? "paused" : "resumed"}`,
        links: { recurringPayment: order.id },
        payload: null,
      });
    },
    [update],
  );

  const skipNextRecurringPayment = React.useCallback(
    (order: RecurringPaymentOrder): void => {
      const keys = orderKeys(order);
      if (!keys) return;
      const now = nowSeconds();
      update(
        "recurringPayment",
        {
          id: keys.id,
          nextDueAtSec: nextDueAfter(
            order,
            Math.max(now, order.schedule.nextDueAtSec),
          ),
          lastRunAtSec: now,
          lastRunStatus: "skipped",
        },
        keys.options,
      );
      pushToast(t("recurringSkippedToast"));
      reportAppLog({
        tag: "recurring.skippedByUser",
        summary: "recurring payment skipped by the user",
        links: { recurringPayment: order.id, contact: order.contactId },
        payload: { dueAtSec: order.schedule.nextDueAtSec },
      });
    },
    [pushToast, t, update],
  );

  const requestDeleteRecurringPayment = React.useCallback(
    (order: RecurringPaymentOrder): boolean => {
      if (pendingDeleteId !== order.id) {
        setPendingDeleteId(order.id);
        return false;
      }
      const keys = orderKeys(order);
      if (!keys) return false;
      update(
        "recurringPayment",
        { id: keys.id, isDeleted: Evolu.sqliteTrue },
        keys.options,
      );
      setPendingDeleteId(null);
      reportAppLog({
        tag: "recurring.deleted",
        summary: "recurring payment deleted",
        links: { recurringPayment: order.id },
        payload: null,
      });
      return true;
    },
    [pendingDeleteId, update],
  );

  const runRecurringPaymentNow = React.useCallback(
    async (order: RecurringPaymentOrder): Promise<void> => {
      const outcome = await runOrderNow(order.id);
      if (outcome === "busy") pushToast(t("recurringWalletBusy"));
    },
    [pushToast, runOrderNow, t],
  );

  return {
    createRecurringPayment,
    pendingRecurringPaymentDeleteId: pendingDeleteId,
    requestDeleteRecurringPayment,
    runRecurringPaymentNow,
    setRecurringPaymentPaused,
    skipNextRecurringPayment,
  };
};
