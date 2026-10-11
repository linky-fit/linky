import {
  createId,
  NonEmptyString100,
  NonEmptyString1000,
  PositiveInt,
} from "@linky-fit/linksync";
import {
  editPatch,
  pausePatch,
  recurringProgressColumn,
  resumePatch,
  type RecurringPaymentOrder,
} from "@linky-fit/recurring-payment";
import { useAtomValue } from "@linky-fit/linkstr-react";
import React from "react";
import { reportAppLog } from "../../../devtools/inspector/appLog";
import { MAIN_MINT_URL, normalizeMintUrl } from "../../../utils/mint";
import { nowSeconds } from "../../../utils/time";
import {
  readContactId,
  recurringPaymentColumns,
  recurringPaymentUpdate,
  type RecurringPaymentInput,
} from "../../lib/recurringPaymentStore";
import { pickRecurringRail, recurringRecipient } from "../../lib/recurringRail";
import { runWrite } from "../../lib/storeWrite";
import { contactsAtom } from "../../state/contacts/readModel";
import { defaultMintAtom } from "../../state/wallet/defaultMint";
import { payWithCashuEnabledAtom } from "../../state/wallet/prefs";
import {
  recurringDeleteArm,
  recurringSchedulerAtom,
} from "../../state/wallet/recurring";
import { usePushToast, useTranslation } from "../shell";
import { useRecurringPaymentsRepository } from "../useLinksync";

export type { RecurringPaymentInput } from "../../lib/recurringPaymentStore";

/** The mint a new recurring payment is bound to. */
export const useRecurringMintUrl = () =>
  normalizeMintUrl(useAtomValue(defaultMintAtom) ?? MAIN_MINT_URL);

export interface RecurringPaymentsActions {
  createRecurringPayment: (input: RecurringPaymentInput) => Promise<boolean>;
  pendingRecurringPaymentDeleteId: string | null;
  requestDeleteRecurringPayment: (
    order: RecurringPaymentOrder,
  ) => Promise<boolean>;
  setRecurringPaymentPaused: (
    order: RecurringPaymentOrder,
    paused: boolean,
  ) => Promise<void>;
  updateRecurringPayment: (
    order: RecurringPaymentOrder,
    input: RecurringPaymentInput,
  ) => Promise<boolean>;
}

/**
 * User-facing mutations on recurring payments, all through the linksync
 * repository. Deleting is a two-tap armed action; the scheduler's next pass
 * settles the deleted payment's envelope.
 */
export const useRecurringPaymentsActions = (): RecurringPaymentsActions => {
  const contacts = useAtomValue(contactsAtom);
  const defaultMintUrl = useRecurringMintUrl();
  const payWithCashuEnabled = useAtomValue(payWithCashuEnabledAtom);
  const pushToast = usePushToast();
  const { t } = useTranslation();
  const repository = useRecurringPaymentsRepository();
  const scheduler = useAtomValue(recurringSchedulerAtom);
  const pendingDeleteId = useAtomValue(recurringDeleteArm.valueAtom);
  const deleteArm = useAtomValue(recurringDeleteArm.commandsAtom);

  const reportWriteFailure = React.useCallback(
    (error: string): false => {
      console.warn("[linky][recurring] write failed", error);
      pushToast(t("recurringSaveFailed"));
      return false;
    },
    [pushToast, t],
  );

  const findContact = React.useCallback(
    (contactId: string) => contacts.find((contact) => contact.id === contactId),
    [contacts],
  );

  const refuseRecipient = React.useCallback((): false => {
    pushToast(t("recurringRecipientUnavailable"));
    return false;
  }, [pushToast, t]);

  const createRecurringPayment = React.useCallback(
    async (input: RecurringPaymentInput): Promise<boolean> => {
      const contactId = readContactId(input.contactId);
      if (contactId === null) return false;
      const rail = pickRecurringRail(
        findContact(contactId),
        payWithCashuEnabled,
      );
      if (rail === null) return refuseRecipient();
      const id = createId<"RecurringPayment">();
      const outcome = await runWrite(
        repository.insert({
          id,
          createdAtSec: PositiveInt.orThrow(nowSeconds()),
          mintUrl: NonEmptyString1000.orThrow(defaultMintUrl),
          rail: NonEmptyString100.orThrow(rail),
          progress: NonEmptyString1000.orThrow(
            recurringProgressColumn({
              runCount: 0,
              nextDueAtSec: input.firstDueAtSec,
            }),
          ),
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
          note: input.note,
          mintUrl: defaultMintUrl,
          rail,
        },
      });
      return true;
    },
    [
      defaultMintUrl,
      findContact,
      payWithCashuEnabled,
      refuseRecipient,
      reportWriteFailure,
      repository,
    ],
  );

  const updateRecurringPayment = React.useCallback(
    async (
      order: RecurringPaymentOrder,
      input: RecurringPaymentInput,
    ): Promise<boolean> => {
      const contactId = readContactId(input.contactId);
      if (contactId === null) return false;
      if (recurringRecipient(findContact(contactId), order.rail) === null) {
        return refuseRecipient();
      }
      const outcome = await runWrite(
        repository.update(order.id, {
          note: null,
          ...recurringPaymentColumns(input, contactId),
          ...recurringPaymentUpdate(editPatch(order, input.firstDueAtSec)),
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
          note: input.note,
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
    [findContact, refuseRecipient, reportWriteFailure, repository],
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
        deleteArm.arm(order.id);
        return false;
      }
      const outcome = await runWrite(repository.remove(order.id));
      deleteArm.disarm();
      if (!outcome.ok) return reportWriteFailure(outcome.error);
      reportAppLog({
        tag: "recurring.deleted",
        summary: "recurring payment deleted",
        links: { recurringPayment: order.id },
        payload: null,
      });
      void scheduler?.runNow();
      return true;
    },
    [deleteArm, pendingDeleteId, reportWriteFailure, repository, scheduler],
  );

  return {
    createRecurringPayment,
    pendingRecurringPaymentDeleteId: pendingDeleteId,
    requestDeleteRecurringPayment,
    setRecurringPaymentPaused,
    updateRecurringPayment,
  };
};
