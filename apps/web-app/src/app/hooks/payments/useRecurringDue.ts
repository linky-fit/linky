import { useAtomValue } from "@linky-fit/linkstr-react";
import React from "react";
import {
  recurringDueConfirmationAtom,
  recurringSchedulerAtom,
} from "../../state/wallet/recurring";

/** The scheduler's countdown for a due payment, and the user's answers to it. */
export const useRecurringDue = () => {
  const dueConfirmation = useAtomValue(recurringDueConfirmationAtom);
  const scheduler = useAtomValue(recurringSchedulerAtom);
  const confirmDueNow = React.useCallback(
    async () => scheduler?.read().confirmDueNow(),
    [scheduler],
  );
  const cancelDue = React.useCallback(
    async () => scheduler?.read().cancelDue(),
    [scheduler],
  );
  return { cancelDue, confirmDueNow, dueConfirmation };
};
