import type { RecurringPaymentId } from "@linky-fit/linksync";
import { Atom } from "effect/reactivity";
import { armAtoms } from "../shell/arm";
import { ownerCommandsAtom } from "../shell/ownerCommands";

/** A due payment waiting for the in-app countdown to end (or the user to decide). */
export interface RecurringDueConfirmation {
  orderId: RecurringPaymentId;
  /** The planned run; confirming pays exactly this one. */
  runIndex: number;
  dueAtSec: number;
  amountSat: number;
  /** When the countdown ends and the payment goes out on its own. */
  sendAtSec: number;
}

/** The countdown the scheduler shows; only the scheduler writes it. */
export const recurringDueConfirmationAtom = Atom.keepAlive(
  Atom.make<RecurringDueConfirmation | null>(null),
);

export interface RecurringSchedulerCommands {
  /** One scheduler pass over every payment. */
  readonly runNow: () => Promise<void>;
  /** Pay the confirmed-due payment now instead of waiting the countdown out. */
  readonly confirmDueNow: () => Promise<void>;
  /** Skip the confirmed-due payment's period; the schedule moves to the next due time. */
  readonly cancelDue: () => Promise<void>;
}

/** The page's one scheduler, mounted by the wallet composition. */
export const recurringSchedulerAtom =
  ownerCommandsAtom<RecurringSchedulerCommands>();

/** The payment whose delete was tapped once; a second tap within 5 s deletes it. */
export const recurringDeleteArm = armAtoms<string>(5000);
