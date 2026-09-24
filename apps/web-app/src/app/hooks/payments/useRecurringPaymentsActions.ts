import {
  createId,
  NonNegativeInt,
  PositiveInt,
  type RecurringPaymentsRepository,
} from "@linky/linksync";
import {
  CLEAR_CLAIM_PATCH,
  pausePatch,
  resumePatch,
  type RecurringPaymentOrder,
} from "@linky/recurring-payment";
import React from "react";
import { reportAppLog } from "../../../devtools/inspector/appLog";
import type { Translate } from "../../../i18n";
import { nowSeconds } from "../../../utils/time";
import {
  readContactId,
  recurringPaymentColumns,
  recurringPaymentUpdate,
  type RecurringPaymentInput,
} from "../../lib/recurringPaymentStore";
import { runWrite } from "../../lib/storeWrite";
import type { RecurringPaymentsScheduler } from "./useRecurringPaymentsScheduler";

export type { RecurringPaymentInput } from "../../lib/recurringPaymentStore";

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
      const contactId = readContactId(input.contactId);
      if (contactId === null) return false;
      const id = createId<"RecurringPayment">();
      const outcome = await runWrite(
        repository.insert({
          id,
          createdAtSec: PositiveInt.orThrow(nowSeconds()),
          runCount: NonNegativeInt.orThrow(0),
          ...recurringPaymentColumns(input, contactId),
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
      const contactId = readContactId(input.contactId);
      if (contactId === null) return false;
      const outcome = await runWrite(
        repository.update(order.id, {
          ...recurringPaymentColumns(input, contactId),
          ...recurringPaymentUpdate(CLEAR_CLAIM_PATCH),
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
      const outcome = await runWrite(
        repository.update(
          order.id,
          recurringPaymentUpdate(
            paused ? pausePatch(now) : resumePatch(order, now),
          ),
        ),
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
