import { OnchainTransferId } from "@linky-fit/domain";
import {
  decodePaymentRequest,
  encodeNostrPaymentRequest,
  encodePaymentRequestPayload,
  parseMintUrl,
  PaymentRequestId,
  type SendReceipt,
} from "@linky-fit/linkshu";
import {
  decodeNprofile,
  type OutboxResult,
  type Pubkey,
  type RelayUrl,
} from "@linky-fit/linkstr";
import type { OnchainTransfersRepository } from "@linky-fit/linksync";
import {
  depositStatus,
  deriveDepositAddress,
  isTerminalStatus,
  parseDepositXpub,
  onchainTransferChannel,
  type BitcoinNetwork,
  type EsploraClient,
  type OperatorTransferStatus,
  type OnchainTransferCancel,
  type OnchainTransferRequest,
  type OnchainTransferUpdate,
} from "@linky-fit/onchain-transfer";
import { Effect, Option, Result } from "effect";
import { messageContent, type MessageContent } from "../domain/chat";
import type { OperatorProfile } from "../domain/profile";
import {
  checkPayout,
  depositProgress,
  ecashRefundAmount,
  firstUnusedAddressIndex,
  isDepositNewlyConfirmed,
  isTransferEcash,
  isTxid,
  isTxidOfAnotherTransfer,
  nextAddressIndex,
  nextUpdate,
  refundPaid,
  requestDenyReason,
  sharedDepositAddresses,
  type UpdateChanges,
} from "../domain/rules";
import {
  transferStatus,
  transferTerms,
  type OperatorTransfer,
} from "../domain/transfer";
import {
  insertRequest,
  markUserCancelled,
  readTransfer,
  readTransfers,
  saveUpdate,
} from "../storage/transfers";
import type { Nostr } from "./nostr";
import type { AlertWatchers } from "./watchers";
import { exclusive } from "./serial";
import { isTransientReceiveError, type Wallet } from "./wallet";

/** Why an operator action did nothing. */
export type TransferActionFailure =
  | { readonly reason: "unknownTransfer" | "notAllowed" | "noProfile" }
  | { readonly reason: "invalidTxid" | "txUnavailable" }
  /** Esplora could not show an unused deposit address. */
  | { readonly reason: "addressUnchecked" }
  /** Another transfer already carries this transaction id. */
  | { readonly reason: "txidReused" }
  /** Less than the amount plus the fee arrived at the deposit address. */
  | { readonly reason: "depositShort" }
  | { readonly reason: "txShort"; readonly paid: number }
  /** A payout or refund of this transfer is already on its way. */
  | { readonly reason: "inFlight" }
  /** The user's payment request names no Nostr transport to pay it over. */
  | { readonly reason: "noTransport" }
  | { readonly reason: "sendFailed"; readonly detail: string };

type ActionResult = Promise<TransferActionFailure | null>;

/** The on-chain operator's side of every on-chain transfer. */
export interface Transfers {
  /** Accepts a request: a payment request for an on-chain send, a fresh deposit address for an on-chain receive. */
  readonly accept: (id: OnchainTransferId) => ActionResult;
  readonly deny: (id: OnchainTransferId, reason: string) => ActionResult;
  /** Cancels an accepted transfer; one whose deposit was seen may still be cancelled. */
  readonly cancel: (id: OnchainTransferId, reason: string) => ActionResult;
  /** On-chain send: completes the transfer once Esplora shows the transaction pays the payout address. */
  readonly confirmPayout: (id: OnchainTransferId, txid: string) => ActionResult;
  /** On-chain receive: pays the user's payment request; the transfer completes once the message left. */
  readonly sendEcash: (id: OnchainTransferId) => ActionResult;
  /** On-chain send: sends the received ecash back in the chat; the transfer is refunded once it left. */
  readonly refundEcash: (id: OnchainTransferId) => ActionResult;
  /** On-chain receive: records the transaction the operator returned the deposit with. */
  readonly confirmRefund: (id: OnchainTransferId, txid: string) => ActionResult;
  /** Reports what arrived at every watched deposit address. */
  readonly checkDeposits: () => Promise<void>;
  /** Whether ecash for the transfer is queued to go out. */
  readonly inFlight: (id: OnchainTransferId) => Promise<boolean>;
}

const UPDATE_REF = "transfer-update:";
const PAYOUT_REF = "transfer-payout:";
const REFUND_REF = "transfer-refund:";
const REASON_MAX_LENGTH = 500;

/** The transfer and the send an ecash outbox ref names. */
const parseSendRef = (prefix: string, ref: string) => {
  const rest = ref.slice(prefix.length);
  const separator = rest.indexOf(":");
  const transferId = rest.slice(0, separator);
  return separator > 0 && OnchainTransferId.is(transferId)
    ? { transferId, operationId: rest.slice(separator + 1) }
    : null;
};

/** The pubkey and relays the payment request asks to be paid over. */
const nostrTransportOf = (
  paymentRequest: string | null,
): { readonly pubkey: Pubkey; readonly relays: readonly RelayUrl[] } | null => {
  const transport = (
    paymentRequest === null ? null : decodePaymentRequest(paymentRequest)
  )?.transports.find((candidate) => candidate.type === "nostr");
  return transport === undefined ? null : decodeNprofile(transport.target);
};

const cleanReason = (reason: string): UpdateChanges => {
  const trimmed = reason.trim().slice(0, REASON_MAX_LENGTH);
  return trimmed === "" ? {} : { reason: trimmed };
};

export const createTransfers = ({
  transfers,
  nostr,
  wallet,
  esplora,
  config,
  loadProfile,
  alertWatchers,
  whenHydrated,
}: {
  readonly transfers: OnchainTransfersRepository;
  readonly nostr: Nostr;
  readonly wallet: Wallet;
  readonly esplora: EsploraClient;
  readonly config: {
    readonly mintUrl: string;
    readonly network: BitcoinNetwork;
  };
  readonly loadProfile: () => Promise<OperatorProfile | null>;
  readonly alertWatchers: AlertWatchers;
  /** Resolves once background writes may run. */
  readonly whenHydrated: () => Promise<void>;
}): Transfers => {
  // Every update reads the transfer's newest revision, and accepting reads the highest address index.
  const serially = exclusive();
  const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
  const load = (id: OnchainTransferId) => run(readTransfer(transfers, id));

  /** Stores the update, then queues it to the user; a later update carries the whole state again. */
  const publish = async (
    transfer: OperatorTransfer,
    update: OnchainTransferUpdate,
    accepted?: Parameters<typeof saveUpdate>[2],
  ) => {
    await run(saveUpdate(transfers, update, accepted));
    await nostr.sendAppMessage(
      onchainTransferChannel.draft(transfer.user, update),
      `${UPDATE_REF}${transfer.id}:${update.revision}`,
    );
  };

  /** Moves the transfer on when its current status allows it; call it within `serially`. */
  const moveNow = async (
    id: OnchainTransferId,
    status: OperatorTransferStatus,
    changes: UpdateChanges = {},
  ): ActionResult => {
    const transfer = await load(id);
    if (transfer === null) return { reason: "unknownTransfer" };
    const update = nextUpdate(transfer, status, changes);
    if (update === null) return { reason: "notAllowed" };
    await publish(transfer, update);
    return null;
  };

  const move = (
    id: OnchainTransferId,
    status: OperatorTransferStatus,
    changes: UpdateChanges = {},
  ): ActionResult => serially(() => moveNow(id, status, changes));

  const onRequest = async (
    request: OnchainTransferRequest,
    from: Pubkey,
    sentAtSec: number,
  ) => {
    const inserted = await run(
      insertRequest(transfers, request, from, sentAtSec),
    );
    const transfer = await load(request.transferId);
    // Someone else's request for a known id, or one already answered.
    if (transfer === null || transfer.user !== from || transfer.update !== null)
      return;
    const reason = requestDenyReason({
      request,
      profile: await loadProfile(),
      network: config.network,
      mintUrl: config.mintUrl,
    });
    if (reason === null) {
      if (inserted) void alertWatchers({ _tag: "requested", transfer });
      return;
    }
    const update = nextUpdate(transfer, "denied", { reason });
    if (update !== null) await publish(transfer, update);
  };

  const onCancel = async (
    cancel: OnchainTransferCancel,
    from: Pubkey,
    sentAtSec: number,
  ) => {
    const transfer = await load(cancel.transferId);
    if (transfer === null || transfer.user !== from) return;
    const status = transferStatus(transfer);
    const fundsMoved = status !== null && status !== "accepted";
    if (transfer.userCancelledAtSec === null) {
      await run(markUserCancelled(transfers, transfer.id, sentAtSec));
      // Once funds moved the two settle it in the chat.
      if (fundsMoved && !isTerminalStatus(status))
        void alertWatchers({ _tag: "cancelledAfterFunds", transfer });
    }
    const update =
      status === null || status === "accepted"
        ? nextUpdate(transfer, "cancelled", {
            reason: "Cancelled by the user.",
          })
        : null;
    if (update !== null) await publish(transfer, update);
  };

  nostr.onInboxEvent(async (event) => {
    if (event._tag !== "AppMessageReceived") return;
    const message = Option.getOrNull(onchainTransferChannel.decode(event));
    if (message === null || message.type === "update") return;
    await whenHydrated();
    await serially(() =>
      message.type === "request"
        ? onRequest(message, event.from, event.sentAt)
        : onCancel(message, event.from, event.sentAt),
    );
  });

  /**
   * Receives the ecash; the transfer-mint sats it brought in, `null` when there
   * are none to count (again). Ecash from another mint or unit is kept but pays no transfer.
   */
  const receive = async (
    text: string,
    content: Extract<MessageContent, { _tag: "ecash" }>,
  ): Promise<number | null> => {
    const received = await wallet.receive(text);
    if (Result.isSuccess(received))
      return isTransferEcash(received.success, config.mintUrl)
        ? received.success.amount
        : null;
    // Unacknowledged, so the next session receives it again.
    if (isTransientReceiveError(received.failure)) throw received.failure;
    if (received.failure._tag !== "TokenAlreadyKnown") return null;
    // A replay after a reload between receiving and recording; its net amount is gone, so the face value stands in.
    const { operationId } = received.failure;
    return operationId !== null &&
      isTransferEcash(content, config.mintUrl) &&
      (await wallet.isReceived(operationId))
      ? content.amount
      : null;
  };

  /** Ecash naming an on-chain send pays it; any other ecash is just received. */
  nostr.onInboxEvent(async (event) => {
    if (event._tag !== "ChatMessageReceived" || event.editOf !== null) return;
    const text =
      event.body._tag === "TokenBody"
        ? event.body.token
        : event.body._tag === "TextBody"
          ? event.body.text
          : null;
    const content = text === null ? null : messageContent(text);
    if (text === null || content?._tag !== "ecash") return;
    await whenHydrated();
    const sats = await receive(text, content);
    const { requestId } = content;
    if (sats === null || requestId === null || !OnchainTransferId.is(requestId))
      return;
    await serially(async () => {
      const transfer = await load(requestId);
      if (
        transfer?.direction !== "send" ||
        transferStatus(transfer) !== "accepted" ||
        sats < transferTerms(transfer).sendAmount
      )
        return;
      const update = nextUpdate(transfer, "fundsReceived", {
        receivedAmount: sats,
      });
      if (update === null) return;
      await publish(transfer, update);
      void alertWatchers({ _tag: "payoutDue", transfer });
    });
  });

  const queuedFor = async (id: OnchainTransferId) =>
    [...(await nostr.queuedRefs())].some(
      (ref) =>
        ref.startsWith(`${PAYOUT_REF}${id}:`) ||
        ref.startsWith(`${REFUND_REF}${id}:`),
    );

  /**
   * Sends ecash for the transfer as a chat message under `ref`; the send stays
   * pending until the outbox result closes it.
   */
  const sendEcashMessage = async (args: {
    readonly amount: number;
    readonly forRequest: boolean;
    readonly message: (receipt: SendReceipt) => string;
    readonly to: Pubkey;
    readonly relays: readonly RelayUrl[];
    readonly ref: (receipt: SendReceipt) => string;
  }): ActionResult => {
    const mint = parseMintUrl(config.mintUrl);
    if (mint === null) return { reason: "sendFailed", detail: "InvalidMint" };
    const sent = await wallet.send(mint, args.amount, args.forRequest);
    if (Result.isFailure(sent))
      return { reason: "sendFailed", detail: sent.failure._tag };
    const receipt = sent.success;
    try {
      await nostr.sendToken(
        args.to,
        args.message(receipt),
        args.ref(receipt),
        args.relays,
      );
      return null;
    } catch (error) {
      console.warn("[onchain-operator] ecash not queued", error);
      await wallet.returnSend(receipt.operationId);
      return { reason: "sendFailed", detail: "NotQueued" };
    }
  };

  /** Closes the send once its message left and moves the transfer on; a failed one goes back to the wallet. */
  const settleEcashSend =
    (
      prefix: string,
      status: OperatorTransferStatus,
      changes: (transfer: OperatorTransfer) => UpdateChanges,
    ) =>
    async (result: OutboxResult) => {
      const sent = parseSendRef(prefix, result.ref);
      if (sent === null) return;
      if (result._tag === "OutboxJobFailed") {
        await wallet.returnSend(sent.operationId);
        return;
      }
      await wallet.forgetSend(sent.operationId);
      await whenHydrated();
      const transfer = await load(sent.transferId);
      if (transfer === null) return;
      await move(transfer.id, status, changes(transfer));
      await nostr.sendPaymentNotice(transfer.user);
    };

  nostr.onOutboxResult(
    PAYOUT_REF,
    settleEcashSend(PAYOUT_REF, "completed", () => ({})),
  );
  nostr.onOutboxResult(
    REFUND_REF,
    settleEcashSend(REFUND_REF, "refunded", (transfer) => ({
      refundAmount: ecashRefundAmount(transfer),
    })),
  );

  let checking: Promise<void> | null = null;
  const checkDeposits = async () => {
    await whenHydrated();
    const all = await run(readTransfers(transfers));
    // Whose deposit it is stays for the operator to settle.
    const shared = sharedDepositAddresses(all);
    const watched = all.flatMap((transfer) => {
      const status = transferStatus(transfer);
      return transfer.direction === "receive" &&
        transfer.depositAddress !== null &&
        !shared.has(transfer.depositAddress) &&
        (status === "accepted" || status === "fundsSeen")
        ? [{ transfer, address: transfer.depositAddress }]
        : [];
    });
    if (watched.length === 0) return;
    const tip = await run(Effect.result(esplora.tipHeight()));
    if (Result.isFailure(tip)) {
      console.warn("[onchain-operator] tip height unavailable", tip.failure);
      return;
    }
    for (const { transfer, address } of watched) {
      const transactions = await run(
        Effect.result(esplora.addressTransactions(address)),
      );
      if (Result.isFailure(transactions)) {
        console.warn(
          "[onchain-operator] deposit unavailable",
          transactions.failure,
        );
        continue;
      }
      const progress = depositProgress(
        transfer,
        depositStatus({
          address,
          transactions: transactions.success,
          tipHeight: tip.success,
        }),
      );
      if (progress !== null) {
        const { status, ...changes } = progress;
        const failure = await move(transfer.id, status, changes);
        if (
          failure === null &&
          (status === "fundsReceived" ||
            isDepositNewlyConfirmed(transfer, progress))
        )
          void alertWatchers({
            _tag: "ecashDue",
            transfer,
            receivedAmount: progress.receivedAmount,
          });
      }
    }
  };

  /** Settles the transfer by a pasted transaction, unless ecash for it is on its way or the transaction settled another transfer. */
  const settleByTxid = (
    id: OnchainTransferId,
    status: "completed" | "refunded",
    txid: string,
    changes: UpdateChanges,
  ): ActionResult =>
    serially(async () => {
      if (await queuedFor(id)) return { reason: "inFlight" };
      if (
        isTxidOfAnotherTransfer(await run(readTransfers(transfers)), id, txid)
      )
        return { reason: "txidReused" };
      return moveNow(id, status, changes);
    });

  const ecashSendGuard = async (
    id: OnchainTransferId,
    direction: OperatorTransfer["direction"],
    status: OperatorTransferStatus,
  ): Promise<TransferActionFailure | OperatorTransfer> => {
    const transfer = await load(id);
    if (transfer === null) return { reason: "unknownTransfer" };
    if (transfer.direction !== direction || transferStatus(transfer) !== status)
      return { reason: "notAllowed" };
    return (await queuedFor(id)) ? { reason: "inFlight" } : transfer;
  };

  return {
    accept: (id) =>
      serially(async () => {
        const transfer = await load(id);
        if (transfer === null) return { reason: "unknownTransfer" };
        if (transferStatus(transfer) !== null) return { reason: "notAllowed" };
        if (transfer.direction === "send") {
          const paymentRequest = encodeNostrPaymentRequest({
            amount: transferTerms(transfer).sendAmount,
            mintUrls: [config.mintUrl],
            recipientNprofile: nostr.nprofile,
            requestId: PaymentRequestId.make(transfer.id),
          });
          const update = nextUpdate(transfer, "accepted", { paymentRequest });
          if (update === null) return { reason: "notAllowed" };
          await publish(transfer, update, {
            operatorPaymentRequest: paymentRequest,
          });
          return null;
        }
        const profile = await loadProfile();
        const xpub =
          profile === null
            ? null
            : parseDepositXpub(profile.xpub, config.network);
        if (xpub === null) return { reason: "noProfile" };
        const addressAt = (index: number) =>
          deriveDepositAddress({ xpub, index, network: config.network });
        const scanned = await run(
          Effect.result(
            firstUnusedAddressIndex(
              nextAddressIndex(await run(readTransfers(transfers))),
              addressAt,
              esplora,
            ),
          ),
        );
        if (Result.isFailure(scanned) || scanned.success === null)
          return { reason: "addressUnchecked" };
        const addressIndex = scanned.success;
        const depositAddress = addressAt(addressIndex);
        const update = nextUpdate(transfer, "accepted", { depositAddress });
        if (update === null) return { reason: "notAllowed" };
        await publish(transfer, update, { depositAddress, addressIndex });
        return null;
      }),
    deny: (id, reason) => move(id, "denied", cleanReason(reason)),
    cancel: (id, reason) => move(id, "cancelled", cleanReason(reason)),
    confirmPayout: async (id, text) => {
      const txid = text.trim().toLowerCase();
      if (!isTxid(txid)) return { reason: "invalidTxid" };
      const transfer = await load(id);
      if (transfer === null) return { reason: "unknownTransfer" };
      if (
        transfer.direction !== "send" ||
        transfer.payoutAddress === null ||
        transferStatus(transfer) !== "fundsReceived"
      )
        return { reason: "notAllowed" };
      const tx = await run(Effect.result(esplora.transaction(txid)));
      if (Result.isFailure(tx)) return { reason: "txUnavailable" };
      const payout = checkPayout(
        tx.success,
        transfer.payoutAddress,
        transfer.amount,
      );
      if (!payout.ok) return { reason: "txShort", paid: payout.paid };
      return settleByTxid(id, "completed", txid, { txid });
    },
    sendEcash: (id) =>
      serially(async () => {
        const transfer = await ecashSendGuard(id, "receive", "fundsReceived");
        if (!("id" in transfer)) return transfer;
        if (
          (transfer.update?.receivedAmount ?? 0) <
          transferTerms(transfer).sendAmount
        )
          return { reason: "depositShort" };
        const transport = nostrTransportOf(transfer.userPaymentRequest);
        if (transport === null) return { reason: "noTransport" };
        const requestId = PaymentRequestId.make(transfer.id);
        return sendEcashMessage({
          amount: transfer.amount,
          forRequest: true,
          message: (receipt) =>
            encodePaymentRequestPayload({
              id: requestId,
              mint: receipt.mint,
              unit: receipt.unit,
              proofs: receipt.proofs,
            }),
          to: transport.pubkey,
          relays: transport.relays,
          ref: (receipt) =>
            `${PAYOUT_REF}${transfer.id}:${receipt.operationId}`,
        });
      }),
    refundEcash: (id) =>
      serially(async () => {
        const transfer = await ecashSendGuard(id, "send", "fundsReceived");
        if (!("id" in transfer)) return transfer;
        return sendEcashMessage({
          amount: ecashRefundAmount(transfer),
          forRequest: false,
          message: (receipt) => receipt.tokenText,
          to: transfer.user,
          relays: [],
          ref: (receipt) =>
            `${REFUND_REF}${transfer.id}:${receipt.operationId}`,
        });
      }),
    confirmRefund: async (id, text) => {
      const refundTxid = text.trim().toLowerCase();
      if (!isTxid(refundTxid)) return { reason: "invalidTxid" };
      const transfer = await load(id);
      if (transfer === null) return { reason: "unknownTransfer" };
      if (transfer.direction !== "receive") return { reason: "notAllowed" };
      const { depositAddress } = transfer;
      const fetched = await run(
        Effect.result(
          Effect.all([
            esplora.transaction(refundTxid),
            depositAddress === null || transfer.refund?.to === "address"
              ? Effect.succeed([])
              : esplora.addressTransactions(depositAddress),
          ]),
        ),
      );
      if (Result.isFailure(fetched)) return { reason: "txUnavailable" };
      const [tx, deposits] = fetched.success;
      const refundAmount = refundPaid(transfer, tx, deposits);
      return settleByTxid(id, "refunded", refundTxid, {
        refundTxid,
        ...(refundAmount === 0 ? {} : { refundAmount }),
      });
    },
    inFlight: queuedFor,
    checkDeposits: () => {
      checking ??= checkDeposits().finally(() => {
        checking = null;
      });
      return checking;
    },
  };
};
