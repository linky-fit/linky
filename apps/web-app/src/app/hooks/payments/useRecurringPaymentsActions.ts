import {
  ContactId,
  createId,
  NonEmptyString100,
  NonNegativeInt,
  PositiveInt,
  type RecurringPaymentsRepository,
} from "@linky-fit/linksync";
import React from "react";
import { reportAppLog } from "../../../devtools/inspector/appLog";
import type { Translate } from "../../../i18n";
import { nowSeconds } from "../../../utils/time";
import type { RecurringAmount } from "../../lib/recurringAmount";
import type { RecurringPaymentOrder } from "../../lib/recurringPaymentOrder";
import { recurringPaymentPatch } from "../../lib/recurringPaymentWrite";
import {
  currentTimeZone,
  nextRecurringOccurrenceAfter,
  resolveTimeZone,
  type RecurringInterval,
} from "../../lib/recurringSchedule";
import { runWrite } from "../../lib/storeWrite";
import type { RecurringPaymentsScheduler } from "./useRecurringPaymentsScheduler";

export interface RecurringPaymentInput {
  amount: RecurringAmount;
  contactId: string;
  /** The next due time; also the anchor every later due time is counted from. */
  firstDueAtSec: number;
  interval: RecurringInterval;
}

export interface RecurringPaymentsActions {
  createRecurringPayment: (input: RecurringPaymentInput) => Promise<boolean>;
  pendingRecurringPaymentDeleteId: string | null;
  requestDeleteRecurringPayment: (
    order: RecurringPaymentOrder,
  ) => Promise<boolean>;
  runRecurringPaymentNow: (order: RecurringPaymentOrder) => Promise<void>;
  setRecurringPaymentPaused: (
    order: RecurringPaymentOrder,
    paused: boolean,
  ) => Promise<void>;
  updateRecurringPayment: (
    order: RecurringPaymentOrder,
    input: RecurringPaymentInput,
  ) => Promise<boolean>;
}

interface UseRecurringPaymentsActionsParams {
  pushToast: (message: string) => void;
  repository: RecurringPaymentsRepository;
  runOrderNow: RecurringPaymentsScheduler["runOrderNow"];
  t: Translate;
}

const DELETE_ARM_MS = 5000;

/** First due time strictly after `afterSec` on the payment's own grid. */
const nextDueAfter = (order: RecurringPaymentOrder, afterSec: number) =>
  nextRecurringOccurrenceAfter(
    order.schedule.anchorAtSec,
    order.schedule.interval,
    afterSec,
    resolveTimeZone(order.schedule.timeZone),
  ).dueAtSec;

/** The schedule and amount columns a form writes, for both insert and edit. */
const scheduleColumns = (input: RecurringPaymentInput) => ({
  amount: PositiveInt.orThrow(input.amount.amount),
  unit: NonEmptyString100.orThrow(input.amount.unit),
  intervalUnit: NonEmptyString100.orThrow(input.interval.unit),
  intervalCount: PositiveInt.orThrow(input.interval.count),
  anchorAtSec: PositiveInt.orThrow(input.firstDueAtSec),
  timeZone: NonEmptyString100.orThrow(currentTimeZone()),
  nextDueAtSec: PositiveInt.orThrow(input.firstDueAtSec),
});

/**
 * User-facing mutations on recurring payments, all through the linksync
 * repository. Deleting is a two-tap armed action.
 */
export const useRecurringPaymentsActions = ({
  pushToast,
  repository,
  runOrderNow,
  t,
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

  const reportWriteFailure = React.useCallback(
    (error: string): false => {
      console.warn("[linky][recurring] write failed", error);
      pushToast(t("recurringSaveFailed"));
      return false;
    },
    [pushToast, t],
  );

  const createRecurringPayment = React.useCallback(
    async (input: RecurringPaymentInput): Promise<boolean> => {
      const contactId = ContactId.fromUnknown(input.contactId);
      if (!contactId.ok) return false;
      const id = createId<"RecurringPayment">();
      const outcome = await runWrite(
        repository.insert({
          id,
          createdAtSec: PositiveInt.orThrow(nowSeconds()),
          contactId: contactId.value,
          runCount: NonNegativeInt.orThrow(0),
          ...scheduleColumns(input),
        }),
      );
      if (!outcome.ok) return reportWriteFailure(outcome.error);
      reportAppLog({
        tag: "recurring.created",
        summary: "recurring payment created",
        links: { recurringPayment: id, contact: input.contactId },
        payload: {
          amount: input.amount,
          firstDueAtSec: input.firstDueAtSec,
          interval: input.interval,
        },
      });
      return true;
    },
    [reportWriteFailure, repository],
  );

  const updateRecurringPayment = React.useCallback(
    async (
      order: RecurringPaymentOrder,
      input: RecurringPaymentInput,
    ): Promise<boolean> => {
      const contactId = ContactId.fromUnknown(input.contactId);
      if (!contactId.ok) return false;
      // A new first due time starts a new grid; an in-flight claim for the
      // old due time no longer applies.
      const outcome = await runWrite(
        repository.update(order.id, {
          contactId: contactId.value,
          ...scheduleColumns(input),
          ...recurringPaymentPatch({
            claimAtSec: null,
            claimDeviceId: null,
            claimDueAtSec: null,
          }),
        }),
      );
      if (!outcome.ok) return reportWriteFailure(outcome.error);
      reportAppLog({
        tag: "recurring.updated",
        summary: "recurring payment edited",
        links: { recurringPayment: order.id, contact: input.contactId },
        payload: {
          amount: input.amount,
          firstDueAtSec: input.firstDueAtSec,
          interval: input.interval,
          previous: {
            amount: order.amount,
            contactId: order.contactId,
            interval: order.schedule.interval,
            nextDueAtSec: order.schedule.nextDueAtSec,
          },
        },
      });
      return true;
    },
    [reportWriteFailure, repository],
  );

  const setRecurringPaymentPaused = React.useCallback(
    async (order: RecurringPaymentOrder, paused: boolean): Promise<void> => {
      const now = nowSeconds();
      // Periods that passed while paused are not paid retroactively.
      const patch = paused
        ? { pausedAtSec: now }
        : {
            pausedAtSec: null,
            nextDueAtSec:
              order.schedule.nextDueAtSec > now
                ? order.schedule.nextDueAtSec
                : nextDueAfter(order, now),
          };
      const outcome = await runWrite(
        repository.update(order.id, recurringPaymentPatch(patch)),
      );
      if (!outcome.ok) {
        reportWriteFailure(outcome.error);
        return;
      }
      reportAppLog({
        tag: paused ? "recurring.paused" : "recurring.resumed",
        summary: `recurring payment ${paused ? "paused" : "resumed"}`,
        links: { recurringPayment: order.id },
        payload: null,
      });
    },
    [reportWriteFailure, repository],
  );

  const requestDeleteRecurringPayment = React.useCallback(
    async (order: RecurringPaymentOrder): Promise<boolean> => {
      if (pendingDeleteId !== order.id) {
        setPendingDeleteId(order.id);
        return false;
      }
      const outcome = await runWrite(repository.remove(order.id));
      setPendingDeleteId(null);
      if (!outcome.ok) return reportWriteFailure(outcome.error);
      reportAppLog({
        tag: "recurring.deleted",
        summary: "recurring payment deleted",
        links: { recurringPayment: order.id },
        payload: null,
      });
      return true;
    },
    [pendingDeleteId, reportWriteFailure, repository],
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
    updateRecurringPayment,
  };
};
