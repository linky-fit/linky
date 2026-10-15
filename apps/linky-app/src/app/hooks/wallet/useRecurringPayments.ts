import type { PlanSendMintArgs } from "@linky-fit/linkshu";
import { useProvideOwnerCommands } from "../shell/ownerCommands";
import type { Translate } from "../../../i18n";
import type {
  DisplayAmountParts,
  FiatRates,
} from "../../../utils/displayAmounts";
import type { PaidOverlayDetails } from "../../lib/paidOverlay";
import type { CashuEnvelopes } from "../../state/linkshu/commands";
import { logPayStep } from "../../state/wallet/paymentLog";
import { recurringSchedulerAtom } from "../../state/wallet/recurring";
import type { ChatWrites } from "../../state/messages/chatWrites";
import type {
  ContactRowLike,
  LocalNostrMessage,
  LoggedPaymentEventParams,
} from "../../types/appTypes";
import { useRecurringPaymentOrders } from "../payments/useRecurringPaymentOrders";
import { useRecurringPaymentsScheduler } from "../payments/useRecurringPaymentsScheduler";
import { useRecurringReminderSync } from "../payments/useRecurringReminderSync";
import { useSendTokenMessage } from "../payments/useSendTokenMessage";
import {
  useAccountHydrated,
  useRecurringPaymentsRepository,
} from "../useLinksync";

interface UseRecurringPaymentsParams {
  chat: Pick<
    ChatWrites,
    "appendLocalNostrMessage" | "updateLocalNostrMessage"
  > & {
    readonly nostrMessagesLocal: readonly LocalNostrMessage[];
  };
  contacts: readonly ContactRowLike[];
  currentNpub: string | null;
  currentNsec: string | null;
  envelopes: CashuEnvelopes | null;
  fiatRates: FiatRates | null;
  formatDisplayedAmountParts: (amountSat: number) => DisplayAmountParts;
  logPaymentEvent: (event: LoggedPaymentEventParams) => void;
  maybeShowPwaNotification: (
    title: string,
    body: string,
    tag?: string,
  ) => Promise<void>;
  mintBalances: PlanSendMintArgs["balances"];
  pushToast: (message: string) => void;
  showPaidOverlay: (title: string, details: PaidOverlayDetails) => void;
  t: Translate;
  /** The wallet can pay; reminders for due payments wait for it. */
  walletReady: boolean;
}

/**
 * Recurring payments: the scheduler, which screens reach through
 * `recurringSchedulerAtom`, and the due-payment reminders.
 */
export const useRecurringPayments = ({
  chat,
  contacts,
  currentNpub,
  currentNsec,
  envelopes,
  fiatRates,
  formatDisplayedAmountParts,
  logPaymentEvent,
  maybeShowPwaNotification,
  mintBalances,
  pushToast,
  showPaidOverlay,
  t,
  walletReady,
}: UseRecurringPaymentsParams) => {
  const repository = useRecurringPaymentsRepository();
  const sendTokenMessage = useSendTokenMessage({
    ...chat,
    currentNpub,
    logPayStep,
  });
  const scheduler = useRecurringPaymentsScheduler({
    contacts,
    envelopes,
    fiatRates,
    formatDisplayedAmountParts,
    hydrated: useAccountHydrated(),
    logPaymentEvent,
    maybeShowPwaNotification,
    mintBalances,
    pushToast,
    repository,
    sendTokenMessage,
    showPaidOverlay,
    t,
  });
  useProvideOwnerCommands(recurringSchedulerAtom, scheduler);
  useRecurringReminderSync({
    currentNsec,
    enabled: walletReady,
    orders: useRecurringPaymentOrders(),
  });

  return { recoverEnvelopes: scheduler.recoverEnvelopes };
};
