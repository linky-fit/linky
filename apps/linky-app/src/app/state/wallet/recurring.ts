import { armAtoms } from "../shell/arm";
import { ownerCommandsAtom } from "../shell/ownerCommands";

export interface RecurringSchedulerCommands {
  /** One scheduler pass over every payment. */
  readonly runNow: () => Promise<void>;
}

/** The page's one scheduler, mounted by the wallet composition. */
export const recurringSchedulerAtom =
  ownerCommandsAtom<RecurringSchedulerCommands>();

/** The payment whose delete was tapped once; a second tap within 5 s deletes it. */
export const recurringDeleteArm = armAtoms<string>(5000);
