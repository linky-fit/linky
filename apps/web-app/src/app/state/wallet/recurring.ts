import type { RecurringPaymentId } from "@linky-fit/linksync";
import { Atom } from "effect/reactivity";

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

/** The page's one scheduler, null until the wallet composition mounted it. */
export const recurringSchedulerAtom = Atom.keepAlive(
  Atom.make<RecurringSchedulerCommands | null>(null),
);

const DELETE_ARM_MS = 5000;

/** The payment whose delete was tapped once; a second tap within 5 s deletes it. */
export const armedRecurringDeleteAtom = Atom.keepAlive(
  Atom.make<string | null>(null),
);

export interface RecurringDeleteArm {
  readonly arm: (id: string) => void;
  readonly disarm: () => void;
}

export const recurringDeleteArmAtom = Atom.keepAlive(
  Atom.readable((get): RecurringDeleteArm => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const clearTimer = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    get.addFinalizer(clearTimer);
    return {
      arm: (id) => {
        clearTimer();
        get.registry.set(armedRecurringDeleteAtom, id);
        timer = setTimeout(() => {
          timer = null;
          get.registry.set(armedRecurringDeleteAtom, null);
        }, DELETE_ARM_MS);
      },
      disarm: () => {
        clearTimer();
        get.registry.set(armedRecurringDeleteAtom, null);
      },
    };
  }),
);
