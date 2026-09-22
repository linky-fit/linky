import {
  NonEmptyString100,
  NonNegativeInt,
  PositiveInt,
  type RecurringPaymentsRepository,
} from "@linky-fit/linksync";
import type { RecurringPaymentRunStatus } from "./recurringPaymentOrder";

export type RecurringPaymentPatch = Parameters<
  RecurringPaymentsRepository["update"]
>[1];

/** The plain-number view of a schedule patch; the engine and the actions build these. */
export interface RecurringPaymentPatchInput {
  claimAtSec?: number | null;
  claimDeviceId?: string | null;
  claimDueAtSec?: number | null;
  lastRunAtSec?: number | null;
  lastRunStatus?: RecurringPaymentRunStatus;
  nextDueAtSec?: number;
  pausedAtSec?: number | null;
  runCount?: number;
}

const positive = (value: number): PositiveInt => PositiveInt.orThrow(value);
const positiveOrNull = (value: number | null): PositiveInt | null =>
  value === null ? null : positive(value);

/** Brands a schedule patch for the repository; its values are ours, so a bad one is a bug. */
export const recurringPaymentPatch = (
  input: RecurringPaymentPatchInput,
): RecurringPaymentPatch => ({
  ...(input.claimAtSec !== undefined
    ? { claimAtSec: positiveOrNull(input.claimAtSec) }
    : {}),
  ...(input.claimDeviceId !== undefined
    ? {
        claimDeviceId:
          input.claimDeviceId === null
            ? null
            : NonEmptyString100.orThrow(input.claimDeviceId),
      }
    : {}),
  ...(input.claimDueAtSec !== undefined
    ? { claimDueAtSec: positiveOrNull(input.claimDueAtSec) }
    : {}),
  ...(input.lastRunAtSec !== undefined
    ? { lastRunAtSec: positiveOrNull(input.lastRunAtSec) }
    : {}),
  ...(input.lastRunStatus !== undefined
    ? { lastRunStatus: NonEmptyString100.orThrow(input.lastRunStatus) }
    : {}),
  ...(input.nextDueAtSec !== undefined
    ? { nextDueAtSec: positive(input.nextDueAtSec) }
    : {}),
  ...(input.pausedAtSec !== undefined
    ? { pausedAtSec: positiveOrNull(input.pausedAtSec) }
    : {}),
  ...(input.runCount !== undefined
    ? { runCount: NonNegativeInt.orThrow(input.runCount) }
    : {}),
});
