import type { PlanSendMintArgs } from "@linky-fit/linkshu";
import React from "react";
import type { Translate } from "../../../i18n";
import type {
  DisplayAmountParts,
  FiatRates,
} from "../../../utils/displayAmounts";
import { MAIN_MINT_URL, normalizeMintUrl } from "../../../utils/mint";
import type { PaidOverlayDetails } from "../../lib/paidOverlay";
import type { CashuEnvelopes } from "../../state/linkshu/commands";
import { logPayStep } from "../../state/wallet/paymentLog";
import type { ChatWrites } from "../../state/messages/chatWrites";
import type {
  ContactRowLike,
  LocalNostrMessage,
  LoggedPaymentEventParams,
} from "../../types/appTypes";
import { useRecurringPaymentOrders } from "../payments/useRecurringPaymentOrders";
import { useRecurringPaymentsActions } from "../payments/useRecurringPaymentsActions";
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
  defaultMintUrl: string | null;
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
  payWithCashuEnabled: boolean;
  pushToast: (message: string) => void;
  showPaidOverlay: (title: string, details: PaidOverlayDetails) => void;
  t: Translate;
  /** The wallet can pay; reminders for due payments wait for it. */
  walletReady: boolean;
}

/** Recurring payments: the scheduler, its screen actions and the due-payment reminders. */
export const useRecurringPayments = ({
  chat,
  contacts,
  currentNpub,
  currentNsec,
  defaultMintUrl,
  envelopes,
  fiatRates,
  formatDisplayedAmountParts,
  logPaymentEvent,
  maybeShowPwaNotification,
  mintBalances,
  payWithCashuEnabled,
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
  const recurringDefaultMintUrl = normalizeMintUrl(
    defaultMintUrl ?? MAIN_MINT_URL,
  );
  const actions = useRecurringPaymentsActions({
    contacts,
    defaultMintUrl: recurringDefaultMintUrl,
    payWithCashuEnabled,
    pushToast,
    repository,
    runNow: scheduler.runNow,
    t,
  });
  useRecurringReminderSync({
    currentNsec,
    enabled: walletReady,
    orders: useRecurringPaymentOrders(),
  });

  const recurringPaymentsContext = React.useMemo(
    () => ({
      ...actions,
      cancelDue: scheduler.cancelDue,
      confirmDueNow: scheduler.confirmDueNow,
      defaultMintUrl: recurringDefaultMintUrl,
      dueConfirmation: scheduler.dueConfirmation,
      mintBalanceSat: (mintUrl: string) =>
        mintBalances.find((entry) => entry.mint === mintUrl)?.amount ?? 0,
    }),
    [
      actions,
      mintBalances,
      recurringDefaultMintUrl,
      scheduler.cancelDue,
      scheduler.confirmDueNow,
      scheduler.dueConfirmation,
    ],
  );

  return {
    recoverEnvelopes: scheduler.recoverEnvelopes,
    recurringPaymentsContext,
  };
};
