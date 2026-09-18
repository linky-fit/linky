import * as Evolu from "@evolu/common";
import React from "react";
import { reportAppLog } from "../../../devtools/inspector/appLog";
import { ContactId, RecurringPaymentId } from "../../../evoluIds";
import { nowSeconds } from "../../../utils/time";
import { getDeviceId } from "../../lib/deviceId";
import type {
  RecurringPaymentOrder,
  RecurringPaymentRecipient,
} from "../../lib/recurringPaymentOrder";
import {
  currentTimeZone,
  nextRecurringOccurrenceAfter,
  resolveTimeZone,
  type RecurringInterval,
} from "../../lib/recurringSchedule";

type EvoluMutations = ReturnType<typeof import("../../../evolu").useEvolu>;

export interface NewRecurringPaymentInput {
  amountSat: number;
  endAtSec: number | null;
  firstDueAtSec: number;
  interval: RecurringInterval;
  maxRuns: number | null;
  note: string | null;
  recipient: RecurringPaymentRecipient;
  title: string;
}

export interface RecurringPaymentsActions {
  bindRecurringPaymentToThisDevice: (order: RecurringPaymentOrder) => void;
  createRecurringPayment: (input: NewRecurringPaymentInput) => boolean;
  deviceId: string;
  pendingRecurringPaymentDeleteId: string | null;
  requestDeleteRecurringPayment: (order: RecurringPaymentOrder) => boolean;
  runRecurringPaymentNow: (order: RecurringPaymentOrder) => Promise<void>;
  setRecurringPaymentPaused: (
    order: RecurringPaymentOrder,
    paused: boolean,
  ) => void;
}

interface UseRecurringPaymentsActionsParams {
  insert: EvoluMutations["insert"];
  runSchedulerNow: () => Promise<void>;
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

/**
 * User-facing mutations on standing orders. Inserts go to the active
 * transactions lane; updates target the row's own lane, like every other
 * lane-routed table. Deleting is a two-tap armed action.
 */
export const useRecurringPaymentsActions = ({
  insert,
  runSchedulerNow,
  transactionsOwnerId,
  update,
}: UseRecurringPaymentsActionsParams): RecurringPaymentsActions => {
  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(
    null,
  );
  const deviceId = React.useMemo(() => getDeviceId(), []);

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
      const now = nowSeconds();
      const contactId =
        input.recipient.kind === "contact"
          ? ContactId.fromUnknown(input.recipient.contactId)
          : null;
      if (contactId !== null && !contactId.ok) return false;
      const payload = {
        createdAtSec: now,
        title: input.title,
        recipientKind: input.recipient.kind,
        ...(contactId?.ok ? { contactId: contactId.value } : {}),
        ...(input.recipient.kind === "lnAddress"
          ? { lnAddress: input.recipient.lnAddress }
          : {}),
        amountSat: input.amountSat,
        intervalUnit: input.interval.unit,
        intervalCount: input.interval.count,
        anchorAtSec: input.firstDueAtSec,
        timeZone: currentTimeZone(),
        nextDueAtSec: input.firstDueAtSec,
        runCount: 0,
        ...(input.maxRuns !== null ? { maxRuns: input.maxRuns } : {}),
        ...(input.endAtSec !== null ? { endAtSec: input.endAtSec } : {}),
        executorDeviceId: deviceId,
        ...(input.note ? { note: input.note } : {}),
      };
      const result = transactionsOwnerId
        ? insert("recurringPayment", payload, { ownerId: transactionsOwnerId })
        : insert("recurringPayment", payload);
      if (!result.ok) return false;
      reportAppLog({
        tag: "recurring.created",
        summary: `standing order created: ${input.title}`,
        links: {
          recurringPayment: result.value.id,
          ...(input.recipient.kind === "contact"
            ? { contact: input.recipient.contactId }
            : {}),
        },
        payload: {
          amountSat: input.amountSat,
          firstDueAtSec: input.firstDueAtSec,
          interval: input.interval,
          recipientKind: input.recipient.kind,
        },
      });
      return true;
    },
    [deviceId, insert, transactionsOwnerId],
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
            : nextRecurringOccurrenceAfter(
                order.schedule.anchorAtSec,
                order.schedule.interval,
                now,
                resolveTimeZone(order.schedule.timeZone),
              ).dueAtSec;
        update(
          "recurringPayment",
          { id: keys.id, pausedAtSec: null, nextDueAtSec },
          keys.options,
        );
      }
      reportAppLog({
        tag: paused ? "recurring.paused" : "recurring.resumed",
        summary: `standing order ${paused ? "paused" : "resumed"}: ${order.title}`,
        links: { recurringPayment: order.id },
        payload: null,
      });
    },
    [update],
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
        summary: `standing order deleted: ${order.title}`,
        links: { recurringPayment: order.id },
        payload: null,
      });
      return true;
    },
    [pendingDeleteId, update],
  );

  const bindRecurringPaymentToThisDevice = React.useCallback(
    (order: RecurringPaymentOrder): void => {
      const keys = orderKeys(order);
      if (!keys) return;
      update(
        "recurringPayment",
        { id: keys.id, executorDeviceId: deviceId },
        keys.options,
      );
    },
    [deviceId, update],
  );

  const runRecurringPaymentNow = React.useCallback(
    async (order: RecurringPaymentOrder): Promise<void> => {
      const keys = orderKeys(order);
      if (!keys) return;
      // Making the order due now keeps the anchor grid: the scheduler pays
      // once and moves on to the next regular due time.
      update(
        "recurringPayment",
        {
          id: keys.id,
          nextDueAtSec: nowSeconds(),
          executorDeviceId: deviceId,
        },
        keys.options,
      );
      await runSchedulerNow();
    },
    [deviceId, runSchedulerNow, update],
  );

  return {
    bindRecurringPaymentToThisDevice,
    createRecurringPayment,
    deviceId,
    pendingRecurringPaymentDeleteId: pendingDeleteId,
    requestDeleteRecurringPayment,
    runRecurringPaymentNow,
    setRecurringPaymentPaused,
  };
};
