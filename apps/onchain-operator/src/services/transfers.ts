import { OnchainTransferId } from "@linky-fit/domain";
import {
  decodePaymentRequest,
  encodeNostrPaymentRequest,
  encodePaymentRequestPayload,
  OperationId,
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
import type {
  OnchainTransferMessagesRepository,
  OnchainTransfersRepository,
} from "@linky-fit/linksync";
import {
  DEFAULT_MIN_RECEIVE_AMOUNT,
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
import { Effect, Option, Result, Schema } from "effect";
import { messageContent } from "../domain/chat";
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
  isAnyAmountReceive,
  transferStatus,
  transferTerms,
  type OperatorTransfer,
} from "../domain/transfer";
import {
  insertRequest,
  markUserCancelled,
  readTransfer,
  readTransfers,
  saveEcashSend,
  saveUpdate,
} from "../storage/transfers";
import { logTransferMessage } from "../storage/transferLog";
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
  /** The Cashu on its way could not be taken back. */
  | {
      readonly reason: "takeBackFailed";
      readonly outcome: "mintUnreachable" | "failed";
    }
  /** The user's payment request names no Nostr transport to pay it over. */
  | { readonly reason: "noTransport" }
  | { readonly reason: "sendFailed"; readonly detail: string };

type ActionResult = Promise<TransferActionFailure | null>;

/**
 * Sats of transfer-mint ecash that named an on-chain send before the operator
 * had accepted it (Linky pays right after requesting, so the Cashu may even
 * beat the request). Kept on the device that received it until the send is
 * accepted and the funds reported.
 */
export interface EarlyEcashStore {
  readonly get: (id: OnchainTransferId) => number | null;
  readonly set: (id: OnchainTransferId, sats: number) => void;
  readonly remove: (id: OnchainTransferId) => void;
}

/** An `EarlyEcashStore` over a key-value store, as one JSON map under `key`. */
export const makeEarlyEcashStore = (
  kv: {
    readonly getItem: (key: string) => string | null;
    readonly setItem: (key: string, value: string) => void;
  },
  key = "onchain-operator.earlyEcash",
): EarlyEcashStore => {
  const read = (): Record<string, number> => {
    try {
      const parsed: unknown = JSON.parse(kv.getItem(key) ?? "{}");
      return typeof parsed === "object" && parsed !== null
        ? Object.fromEntries(
            Object.entries(parsed).filter(
              (entry): entry is [string, number] =>
                typeof entry[1] === "number",
            ),
          )
        : {};
    } catch {
      return {};
    }
  };
  const write = (map: Record<string, number>) =>
    kv.setItem(key, JSON.stringify(map));
  return {
    get: (id) => read()[id] ?? null,
    set: (id, sats) => write({ ...read(), [id]: sats }),
    remove: (id) => {
      const map = read();
      delete map[id];
      write(map);
    },
  };
};

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
  /**
   * Takes back the Cashu on its way for the transfer, as when the device that
   * queued it is gone; a transfer whose user already claimed it moves on.
   */
  readonly takeBackEcash: (id: OnchainTransferId) => ActionResult;
  /** Reports what arrived at every watched deposit address. */
  readonly checkDeposits: () => Promise<void>;
  /** Sats that arrived for the send on this device before it was accepted, short of what it needs; `null` when none wait. */
  readonly earlyEcash: (id: OnchainTransferId) => number | null;
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
  const operationId = Option.getOrNull(
    Schema.decodeUnknownOption(OperationId)(rest.slice(separator + 1)),
  );
  return separator > 0 &&
    OnchainTransferId.is(transferId) &&
    operationId !== null
    ? { transferId, operationId }
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
  transferMessages,
  nostr,
  wallet,
  esplora,
  config,
  loadProfile,
  alertWatchers,
  earlyEcash,
  whenHydrated,
}: {
  readonly transfers: OnchainTransfersRepository;
  /** Where every transfer message a user sent is kept raw. */
  readonly transferMessages: OnchainTransferMessagesRepository;
  readonly nostr: Nostr;
  readonly wallet: Wallet;
  readonly esplora: EsploraClient;
  readonly config: {
    readonly mintUrl: string;
    readonly network: BitcoinNetwork;
  };
  readonly loadProfile: () => Promise<OperatorProfile | null>;
  readonly alertWatchers: AlertWatchers;
  readonly earlyEcash: EarlyEcashStore;
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

  /** Reports the ecash that arrived for the send before it was accepted, once it covers the amount plus the fee. */
  const settleEarlyEcash = async (id: OnchainTransferId) => {
    const sats = earlyEcash.get(id);
    const transfer = await load(id);
    if (
      sats === null ||
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
    earlyEcash.remove(id);
    void alertWatchers({ _tag: "payoutDue", transfer });
  };

  /** Accepts the transfer: a payment request for an on-chain send, a fresh deposit address for an on-chain receive; call it within `serially`. */
  const acceptNow = async (transfer: OperatorTransfer): ActionResult => {
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
      await settleEarlyEcash(transfer.id);
      return null;
    }
    const profile = await loadProfile();
    const xpub =
      profile === null ? null : parseDepositXpub(profile.xpub, config.network);
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
  };

  /**
   * Stores the request and accepts it on arrival: an on-chain send always,
   * since the user's Cashu is already on its way (one the operator would
   * rather not take is flagged in the console for a refund); an on-chain
   * receive once it passes the deny rules, so Linky shows the deposit address
   * right away. A receive the console could not give an address to (no key,
   * Esplora silent) waits for the operator as before.
   */
  const onRequest = async (
    request: OnchainTransferRequest,
    from: Pubkey,
    sentAtSec: number,
  ) => {
    const profile = await loadProfile();
    const inserted = await run(
      insertRequest(
        transfers,
        request,
        from,
        sentAtSec,
        profile?.minReceiveAmount ?? DEFAULT_MIN_RECEIVE_AMOUNT,
      ),
    );
    const transfer = await load(request.transferId);
    // Someone else's request for a known id, or one already answered.
    if (transfer === null || transfer.user !== from || transfer.update !== null)
      return;
    if (transfer.direction === "send") {
      const failure = await acceptNow(transfer);
      if (failure !== null)
        console.warn("[onchain-operator] send not accepted", failure);
      return;
    }
    const reason = requestDenyReason({
      request,
      profile,
      network: config.network,
      mintUrl: config.mintUrl,
    });
    if (reason === null) {
      const failure = await acceptNow(transfer);
      if (failure === null) return;
      console.warn("[onchain-operator] receive not accepted", failure);
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
    if (
      event._tag !== "AppMessageReceived" ||
      event.app !== onchainTransferChannel.app
    )
      return;
    const message = Option.getOrNull(onchainTransferChannel.decode(event));
    await whenHydrated();
    await run(
      logTransferMessage(transferMessages, event, message?.transferId ?? null),
    );
    if (message === null || message.type === "update") return;
    await serially(() =>
      message.type === "request"
        ? onRequest(message, event.from, event.sentAt)
        : onCancel(message, event.from, event.sentAt),
    );
  });

  /**
   * Receives the ecash; the transfer-mint sats it brought in, `null` when there
   * are none. Ecash from another mint or unit is kept but pays no transfer, and
   * ecash the wallet already holds pays none again, whichever transfer the
   * message names.
   */
  const receive = async (text: string): Promise<number | null> => {
    const received = await wallet.receive(text);
    if (Result.isSuccess(received))
      return isTransferEcash(received.success, config.mintUrl)
        ? received.success.amount
        : null;
    // Unacknowledged, so the next session receives it again.
    if (isTransientReceiveError(received.failure)) throw received.failure;
    return null;
  };

  /** Ecash naming an on-chain send pays it, kept aside until the send is accepted; any other ecash is just received. */
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
    const sats = await receive(text);
    const { requestId } = content;
    if (sats === null || requestId === null || !OnchainTransferId.is(requestId))
      return;
    await serially(async () => {
      const transfer = await load(requestId);
      if (transfer !== null && transfer.direction !== "send") return;
      // Linky pays right after requesting, so the Cashu may beat the request or the accept.
      if (transfer === null || transferStatus(transfer) === null) {
        earlyEcash.set(requestId, (earlyEcash.get(requestId) ?? 0) + sats);
        return;
      }
      if (
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

  /** What the transfer becomes once its Cashu reached the user: a receive's payout completes it, a send's refund refunds it. */
  const deliveredUpdate = (transfer: OperatorTransfer) =>
    transfer.direction === "receive"
      ? nextUpdate(transfer, "completed")
      : nextUpdate(transfer, "refunded", {
          refundAmount: ecashRefundAmount(transfer),
        });

  /**
   * Settles the transfer whose send `operationId` was taken back, if it is
   * still that send: moved on when the user had already claimed the Cashu,
   * payable again otherwise; call it within `serially`.
   */
  const settleTakenBack = async (
    id: OnchainTransferId,
    operationId: OperationId,
    outcome: "returned" | "claimed",
  ) => {
    const transfer = await load(id);
    if (transfer?.ecashSendId !== operationId) return;
    if (outcome === "claimed") {
      const update = deliveredUpdate(transfer);
      if (update !== null) await publish(transfer, update);
    }
    await run(saveEcashSend(transfers, id, null));
  };

  /**
   * Sends ecash for the transfer as a chat message under `ref`. The send is
   * recorded on the transfer first, so no device sends again until its
   * outbox result or a take-back clears it.
   */
  const sendEcashMessage = async (args: {
    readonly transferId: OnchainTransferId;
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
    const recorded = await run(
      Effect.result(
        saveEcashSend(transfers, args.transferId, receipt.operationId),
      ),
    );
    if (Result.isFailure(recorded)) {
      await wallet.takeBack(receipt.operationId);
      return { reason: "sendFailed", detail: recorded.failure._tag };
    }
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
      if ((await wallet.takeBack(receipt.operationId)) === "returned")
        await settleTakenBack(args.transferId, receipt.operationId, "returned");
      return { reason: "sendFailed", detail: "NotQueued" };
    }
  };

  /** Closes the send once its message left and moves the transfer on; a failed one goes back to the wallet. */
  const settleEcashSend = (prefix: string) => async (result: OutboxResult) => {
    const sent = parseSendRef(prefix, result.ref);
    if (sent === null) return;
    if (result._tag === "OutboxJobFailed") {
      const outcome = await wallet.takeBack(sent.operationId);
      // Unacknowledged, so the next session takes it back again.
      if (outcome === "mintUnreachable") throw new Error("Mint unreachable");
      await whenHydrated();
      if (outcome !== "failed")
        await serially(() =>
          settleTakenBack(sent.transferId, sent.operationId, outcome),
        );
      return;
    }
    await wallet.forgetSend(sent.operationId);
    await whenHydrated();
    const delivered = await serially(async () => {
      const transfer = await load(sent.transferId);
      // Taken back on another device, so this message carried worthless Cashu.
      if (transfer?.ecashSendId !== sent.operationId) return null;
      const update = deliveredUpdate(transfer);
      if (update !== null) await publish(transfer, update);
      await run(saveEcashSend(transfers, transfer.id, null));
      return transfer;
    });
    if (delivered !== null) await nostr.sendPaymentNotice(delivered.user);
  };

  nostr.onOutboxResult(PAYOUT_REF, settleEcashSend(PAYOUT_REF));
  nostr.onOutboxResult(REFUND_REF, settleEcashSend(REFUND_REF));

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
    const profile = await loadProfile();
    const limits =
      profile === null
        ? null
        : {
            minReceiveAmount: profile.minReceiveAmount,
            maxReceiveAmount: profile.maxReceiveAmount,
          };
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
      // A receive of any amount needs the limits to price its deposit.
      if (limits === null && isAnyAmountReceive(transfer)) continue;
      const progress = depositProgress(
        transfer,
        depositStatus({
          address,
          transactions: transactions.success,
          tipHeight: tip.success,
        }),
        limits,
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
      const transfer = await load(id);
      if (transfer !== null && transfer.ecashSendId !== null)
        return { reason: "inFlight" };
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
    return transfer.ecashSendId === null ? transfer : { reason: "inFlight" };
  };

  return {
    accept: (id) =>
      serially(async () => {
        const transfer = await load(id);
        if (transfer === null) return { reason: "unknownTransfer" };
        return acceptNow(transfer);
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
        transferTerms(transfer).amount,
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
          transferId: transfer.id,
          amount: transferTerms(transfer).amount,
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
          transferId: transfer.id,
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
    takeBackEcash: (id) =>
      serially(async () => {
        const transfer = await load(id);
        if (transfer === null) return { reason: "unknownTransfer" };
        if (transfer.ecashSendId === null) return { reason: "notAllowed" };
        const operationId = transfer.ecashSendId;
        const outcome = await wallet.takeBack(operationId);
        if (outcome === "mintUnreachable" || outcome === "failed")
          return { reason: "takeBackFailed", outcome };
        await settleTakenBack(id, operationId, outcome);
        return null;
      }),
    checkDeposits: () => {
      checking ??= checkDeposits().finally(() => {
        checking = null;
      });
      return checking;
    },
    earlyEcash: (id) => earlyEcash.get(id),
  };
};
