import { PaymentRequestId } from "@linky-fit/linkshu/payment-request";
import {
  createId,
  PositiveInt,
  type OnchainTransferId,
} from "@linky-fit/linksync";
import { OutboxRef, type Pubkey } from "@linky-fit/linkstr";
import {
  AsyncResult,
  RegistryContext,
  useAtomSet,
  useAtomValue,
  useLinkstrCommands,
} from "@linky-fit/linkstr-react";
import {
  amountWithServiceFee,
  canUserCancel,
  onchainTransferChannel,
  type OnchainConfig,
  type OnchainTransferMessage,
} from "@linky-fit/onchain-transfer";
import { Cause, Exit } from "effect";
import React from "react";
import { reportAppLog } from "../../devtools/inspector/appLog";
import { navigateTo } from "../../hooks/useRouting";
import { formatMiddleDots } from "../../utils/formatting";
import { nowSeconds } from "../../utils/time";
import { onchainOperator } from "../lib/onchainOperator";
import {
  isOnchainSendUnpaid,
  newOnchainTransferProblem,
  onchainSendPaymentRequest,
  onchainTransferView,
  planOnchainTransfer,
  unfinishedOnchainTransfers,
  type NewOnchainTransferDraft,
  type OnchainTransferView,
} from "../lib/onchainTransfers";
import {
  buildCashuPaymentRequestMessage,
  parseCashuPaymentRequestMessage,
} from "../lib/paymentRequestMessage";
import {
  paidAtSecByRequestId,
  receivedSatByRequestId,
} from "../lib/paymentRequestStatus";
import { runWrite } from "../lib/storeWrite";
import { currentNpubAtom } from "../state/session/session";
import {
  onchainConfigAtom,
  type OnchainConfigState,
} from "../state/wallet/onchainConfig";
import { onchainTransfersAtom } from "../state/wallet/onchainTransfers";
import { useSaveNpubContact } from "./contacts/useSaveNpubContact";
import { useDisplayAmounts, useSetStatus, useTranslation } from "./shell";
import {
  useOnchainTransferRecords,
  useOnchainTransfersRepository,
  useTransactionRecords,
} from "./useLinksync";
import { useOwnNprofile } from "./useOwnNprofile";
import { useWalletCommands } from "./wallet/useWalletCommands";

/** Derives the transfers' phases from their rows and the payment history into `onchainTransfersAtom`; `OnchainTransfersSync` runs it while the feature shows. */
export const useOnchainTransfersSync = (): void => {
  const records = useOnchainTransferRecords();
  const transactions = useTransactionRecords();
  const setTransfers = useAtomSet(onchainTransfersAtom);
  React.useEffect(() => {
    if (onchainOperator === null) return;
    const operator = onchainOperator.pubkey;
    const history = {
      paidAtSec: paidAtSecByRequestId(transactions),
      received: receivedSatByRequestId(transactions),
    };
    setTransfers(
      records.flatMap(
        (record) => onchainTransferView(record, operator, history) ?? [],
      ),
    );
  }, [records, setTransfers, transactions]);
  React.useEffect(() => () => setTransfers(null), [setTransfers]);
};

/** Whether on-chain transfers show: an on-chain operator is configured. */
export const useOnchainTransfersShown = (): boolean =>
  useAtomValue(onchainTransfersAtom, (transfers) => transfers !== null);

const NO_ONCHAIN_TRANSFERS: readonly OnchainTransferView[] = [];

/** The user's transfers with the on-chain operator, with the phase each is in; none while the feature is hidden. */
export const useOnchainTransfers = (): readonly OnchainTransferView[] =>
  useAtomValue(onchainTransfersAtom) ?? NO_ONCHAIN_TRANSFERS;

/** The label and target of the wallet's link to unfinished transfers: the transfer when one runs, else the history; null when none does. */
export const usePendingOnchainTransfersLink = (): {
  readonly label: string;
  readonly open: () => void;
} | null => {
  const { t } = useTranslation();
  const pending = unfinishedOnchainTransfers(useOnchainTransfers());
  const [only] = pending;
  if (only === undefined) return null;
  return pending.length === 1
    ? {
        label: t("onchainTransferPendingOne"),
        open: () => navigateTo({ route: "onchainTransfer", id: only.id }),
      }
    : {
        label: t("onchainTransferPendingMany").replace(
          "{count}",
          String(pending.length),
        ),
        open: () => navigateTo({ route: "transactions" }),
      };
};

const UNAVAILABLE: OnchainConfigState = { status: "unavailable" };

/** Follows the on-chain config while a transfer screen is open. */
export const useOnchainConfig = (): OnchainConfigState => {
  const state = useAtomValue(onchainConfigAtom);
  if (onchainOperator === null) return UNAVAILABLE;
  return AsyncResult.isSuccess(state)
    ? state.value
    : AsyncResult.isFailure(state)
      ? UNAVAILABLE
      : { status: "loading" };
};

const outboxRef = (message: OnchainTransferMessage) =>
  OutboxRef.make(`onchainTransfer:${message.type}:${message.transferId}`);

/** Requesting, cancelling and paying transfers, and opening the support chat. */
export const useOnchainTransferCommands = () => {
  const { t } = useTranslation();
  const setStatus = useSetStatus();
  const registry = React.useContext(RegistryContext);
  const transfers = useOnchainTransfersRepository();
  const { enqueueOutbox } = useLinkstrCommands();
  const saveNpubContact = useSaveNpubContact();
  const ownNprofile = useOwnNprofile(useAtomValue(currentNpubAtom));
  const { payOnchainTransferPaymentRequest } = useWalletCommands();
  const { formatDisplayedAmountText } = useDisplayAmounts();

  const fail = React.useCallback(
    (detail: string) => setStatus(`${t("errorPrefix")}: ${detail}`),
    [setStatus, t],
  );

  const send = React.useCallback(
    async (operator: Pubkey, message: OnchainTransferMessage) => {
      const exit = await enqueueOutbox({
        op: {
          _tag: "appMessage",
          draft: onchainTransferChannel.draft(operator, message),
        },
        ref: outboxRef(message),
      });
      if (Exit.isSuccess(exit)) return exit.value.rumorId;
      fail(Cause.pretty(exit.cause));
      return null;
    },
    [enqueueOutbox, fail],
  );

  /** Opens the support chat, saving the operator as a contact unless it is one. */
  const contactSupport = React.useCallback(
    (transferId: OnchainTransferId | null) => {
      if (onchainOperator === null) return;
      const contactId =
        saveNpubContact(onchainOperator.npub)?.contact.id ?? null;
      reportAppLog({
        tag: "onchainTransfer.supportOpened",
        summary: "The user opened the support chat from an on-chain transfer",
        links: transferId === null ? {} : { onchainTransfer: transferId },
        payload: { opened: contactId !== null },
      });
      if (contactId !== null) navigateTo({ route: "chat", id: contactId });
    },
    [saveNpubContact],
  );

  /**
   * Pays the operator for an on-chain send: the amount plus the fee as a
   * NUT-18 payment naming the transfer, from the usual payment flow, which
   * reviews it only when a mint has to be added. `onPaid` records the time.
   */
  const payOnchainSend = React.useCallback(
    (
      transfer: Pick<
        OnchainTransferView,
        "id" | "amount" | "sendAmount" | "payoutAddress"
      >,
      config: OnchainConfig,
    ): void => {
      if (onchainOperator === null || transfer.payoutAddress === null) return;
      const request = parseCashuPaymentRequestMessage(
        onchainSendPaymentRequest(
          transfer,
          config.mintUrl,
          onchainOperator.pubkey,
        ),
      );
      if (request === null) {
        setStatus(t("onchainTransferRequestFailed"));
        return;
      }
      reportAppLog({
        tag: "onchainTransfer.sendTapped",
        summary: `Paying the on-chain operator ${transfer.sendAmount} sat for the transfer`,
        links: { onchainTransfer: transfer.id, paymentRequest: transfer.id },
        payload: { amount: transfer.sendAmount },
      });
      void payOnchainTransferPaymentRequest(request, {
        // The operator may deny or the user cancel while the payment is reviewed or in flight; a transfer the atom does not hold yet was just stored.
        isPaymentAuthorized: () => {
          const current = (registry.get(onchainTransfersAtom) ?? []).find(
            (candidate) => candidate.id === transfer.id,
          );
          return current === undefined || isOnchainSendUnpaid(current);
        },
        recipientName: formatMiddleDots(transfer.payoutAddress, 20),
        summary: t("onchainSendConfirmSummary").replace(
          "{amount}",
          formatDisplayedAmountText(transfer.amount),
        ),
        onPaid: () => {
          void runWrite(
            transfers.update(transfer.id, {
              sentAtSec: PositiveInt.orThrow(nowSeconds()),
            }),
          ).then((outcome) => {
            if (!outcome.ok) fail(outcome.error);
          });
        },
      });
    },
    [
      fail,
      formatDisplayedAmountText,
      payOnchainTransferPaymentRequest,
      registry,
      setStatus,
      transfers,
      t,
    ],
  );

  /** Stores the transfer, sends the request, pays a send right away and opens the transfer; false when nothing was requested. */
  const requestOnchainTransfer = React.useCallback(
    async (
      draft: NewOnchainTransferDraft,
      config: OnchainConfig,
    ): Promise<boolean> => {
      if (onchainOperator === null) return false;
      if (newOnchainTransferProblem(draft, config) !== null) return false;
      const operator = onchainOperator.pubkey;
      const id = createId<"OnchainTransfer">();
      let userPaymentRequest: string | null = null;
      if (draft.direction === "receive") {
        if (ownNprofile === null) {
          setStatus(t("profileMissingNpub"));
          return false;
        }
        // No amount: the deposit sets it.
        userPaymentRequest = buildCashuPaymentRequestMessage({
          amount: null,
          mintUrls: [config.mintUrl],
          recipientNprofile: ownNprofile,
          requestId: PaymentRequestId.make(id),
        });
      }
      const planned = planOnchainTransfer({
        draft,
        config,
        id,
        nowSec: nowSeconds(),
        operator,
        userPaymentRequest,
      });
      if (planned === null) {
        setStatus(t("onchainTransferRequestFailed"));
        return false;
      }
      const stored = await runWrite(transfers.insert(planned.row));
      if (!stored.ok) {
        fail(stored.error);
        return false;
      }
      const rumorId = await send(operator, planned.request);
      if (rumorId === null) {
        // Never sent, so the transfer must not wait for an answer.
        void runWrite(
          transfers.update(id, { cancelledAtSec: planned.row.createdAtSec }),
        );
        return false;
      }
      reportAppLog({
        tag: "onchainTransfer.requested",
        summary:
          draft.amount === null
            ? "Requested an on-chain receive of any amount"
            : `Requested an on-chain ${draft.direction} of ${draft.amount} sat`,
        links: { onchainTransfer: id, paymentRequest: id, rumor: rumorId },
        payload: {
          direction: draft.direction,
          amount: draft.amount,
          feeBasisPoints: config.feeBasisPoints,
          network: config.network,
        },
      });
      if (draft.direction === "send" && draft.amount !== null) {
        payOnchainSend(
          {
            id,
            amount: draft.amount,
            sendAmount: amountWithServiceFee(
              draft.amount,
              config.feeBasisPoints,
            ),
            payoutAddress: planned.request.payoutAddress ?? null,
          },
          config,
        );
      }
      navigateTo({ route: "onchainTransfer", id });
      return true;
    },
    [fail, ownNprofile, payOnchainSend, send, setStatus, transfers, t],
  );

  const cancelOnchainTransfer = React.useCallback(
    async (transfer: OnchainTransferView): Promise<void> => {
      if (onchainOperator === null || !canUserCancel(transfer.phase)) return;
      const rumorId = await send(onchainOperator.pubkey, {
        v: 1,
        type: "cancel",
        transferId: transfer.id,
      });
      if (rumorId === null) return;
      const written = await runWrite(
        transfers.update(transfer.id, {
          cancelledAtSec: PositiveInt.orThrow(nowSeconds()),
        }),
      );
      if (!written.ok) fail(written.error);
      reportAppLog({
        tag: "onchainTransfer.cancelSent",
        summary: `Asked the on-chain operator to cancel the transfer (${transfer.phase})`,
        links: {
          onchainTransfer: transfer.id,
          paymentRequest: transfer.id,
          rumor: rumorId,
        },
        payload: { phase: transfer.phase, direction: transfer.direction },
      });
    },
    [fail, send, transfers],
  );

  /** Pays an on-chain send the user still owes, e.g. one whose payment did not go through right after requesting. */
  const sendOnchainTransferPayment = React.useCallback(
    (transfer: OnchainTransferView, config: OnchainConfig): void => {
      if (!isOnchainSendUnpaid(transfer)) return;
      payOnchainSend(transfer, config);
    },
    [payOnchainSend],
  );

  return {
    cancelOnchainTransfer,
    contactSupport,
    requestOnchainTransfer,
    sendOnchainTransferPayment,
  };
};
