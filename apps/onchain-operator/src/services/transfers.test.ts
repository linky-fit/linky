import { createId, type OnchainTransferId } from "@linky-fit/domain";
import {
  Amount,
  decodePaymentRequest,
  MintUrl,
  OperationId,
  decodePaymentRequestPayload,
  encodeNostrPaymentRequest,
  PaymentRequestId,
  ReceiveDeferred,
  TokenAlreadyKnown,
} from "@linky-fit/linkshu";
import {
  AppMessageReceived,
  encodeNprofile,
  OutboxJobFailed,
  OutboxJobId,
  OutboxJobSucceeded,
  OutboxRef,
  RelayUrl,
  type Pubkey,
} from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import {
  makeOnchainTransferMessagesRepository,
  makeOnchainTransfersRepository,
  NonEmptyString1000,
  NonNegativeInt,
} from "@linky-fit/linksync";
import {
  deriveDepositAddress,
  type OnchainTransferMessage,
  type OnchainTransferRequest,
  type OnchainTransferUpdate,
} from "@linky-fit/onchain-transfer";
import { Effect, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import type { OperatorProfile } from "../domain/profile";
import { readTransferLog } from "../storage/transferLog";
import { readTransfer } from "../storage/transfers";
import type { WatcherAlert } from "../domain/watchers";
import { createTransfers } from "./transfers";
import {
  chatTextFrom,
  deliver,
  fakeEsplora,
  fakeNostr,
  fakeWallet,
  nut18Payload,
  receiveReceipt,
  transferMessageFrom,
  testMint,
  testStore,
  txPaying,
} from "./testing/fakes";

const tpub =
  "tpubDDfvzhdVV4unsoKt5aE6dcsNsfeWbTgmLZPi8LQDYU2xixrYemMfWJ3BaVneH3u7DBQePdTwhpybaKRU95pi6PMUtLPBJLVQRpzEnjfjZzX";
const payoutAddress = "bcrt1q6rz28mcfaxtmd6v789l9rrlrusdprr9pz3cppk";

const profile: OperatorProfile = {
  name: "On-chain operator",
  xpub: tpub,
  feeBasisPoints: 100,
  paused: false,
  description: "",
  amounts: [100_000, 250_000],
  minClientVersion: null,
  watchers: [],
  picture: null,
};

const setup = (
  options: {
    readonly profile?: OperatorProfile | null;
    readonly wallet?: ReturnType<typeof fakeWallet>;
    /** Another device's synced account; a fresh store when omitted. */
    readonly store?: ReturnType<typeof testStore>;
  } = {},
) => {
  const store = options.store ?? testStore();
  const repository = makeOnchainTransfersRepository(store);
  const transferMessages = makeOnchainTransferMessagesRepository(store);
  const nostr = fakeNostr();
  const wallet = options.wallet ?? fakeWallet();
  const esplora = fakeEsplora();
  const alerts: WatcherAlert["_tag"][] = [];
  const transfers = createTransfers({
    transfers: repository,
    transferMessages,
    nostr: nostr.nostr,
    wallet: wallet.wallet,
    esplora: esplora.esplora,
    config: { mintUrl: testMint, network: "regtest" },
    loadProfile: async () =>
      options.profile === undefined ? profile : options.profile,
    alertWatchers: async (alert) => {
      alerts.push(alert._tag);
    },
    whenHydrated: () => Promise.resolve(),
  });
  const user = makeIdentity().pubkey;
  const send = (message: OnchainTransferMessage, from: Pubkey = user) =>
    deliver(nostr.inbox, transferMessageFrom(from, message));
  const stored = async (id: OnchainTransferId) => {
    const transfer = await Effect.runPromise(readTransfer(repository, id));
    if (transfer === null) throw new Error("transfer not stored");
    return transfer;
  };
  const updates = () =>
    nostr
      .transferMessages()
      .filter(
        (message): message is OnchainTransferUpdate =>
          message.type === "update",
      );
  return {
    transfers,
    store,
    repository,
    transferMessages,
    nostr,
    wallet,
    esplora,
    user,
    send,
    stored,
    updates,
    alerts,
  };
};

const sendRequest = (
  transferId = createId<"OnchainTransfer">(),
): OnchainTransferRequest => ({
  v: 1,
  type: "request",
  transferId,
  direction: "send",
  amount: 100_000,
  feeBasisPoints: 100,
  payoutAddress,
});

const receiveRequest = (
  user: Pubkey,
  transferId = createId<"OnchainTransfer">(),
): OnchainTransferRequest => ({
  v: 1,
  type: "request",
  transferId,
  direction: "receive",
  amount: 100_000,
  feeBasisPoints: 100,
  refund: { to: "sender" },
  paymentRequest: encodeNostrPaymentRequest({
    amount: 100_000,
    mintUrls: [testMint],
    recipientNprofile: encodeNprofile(user, ["ws://localhost:7777"]),
    requestId: PaymentRequestId.make(transferId),
  }),
});

const succeeded = (ref: string) =>
  Schema.decodeUnknownSync(OutboxJobSucceeded)({
    _tag: "OutboxJobSucceeded",
    jobId: "job",
    ref,
    receipt: {
      _tag: "AppMessageReceipt",
      rumorId: "00".repeat(32),
      clientId: "client",
      sentAt: 1_700_000_000,
      recipientCopy: {
        wrapId: "11".repeat(32),
        acceptedBy: [],
        rejectedBy: [],
      },
    },
  });

/** Delivers an outbox result to the handlers its ref matches. */
const settle = async (
  nostr: ReturnType<typeof fakeNostr>,
  result: OutboxJobSucceeded | OutboxJobFailed,
) => {
  for (const { refPrefix, handler } of nostr.outbox)
    if (result.ref.startsWith(refPrefix)) await handler(result);
};

describe("transfer requests", () => {
  it("stores a request for the operator to decide and answers nothing yet", async () => {
    const { send, stored, updates, user, alerts } = setup();
    const request = sendRequest();
    await send(request);
    await send(request);
    expect(alerts).toEqual(["requested"]);
    expect(await stored(request.transferId)).toMatchObject({
      user,
      direction: "send",
      amount: 100_000,
      payoutAddress,
      update: null,
    });
    expect(updates()).toEqual([]);
  });

  it("denies a request it cannot take, once, with the reason", async () => {
    const { send, stored, updates, alerts } = setup({
      profile: { ...profile, paused: true },
    });
    const request = sendRequest();
    await send(request);
    await send(request);
    expect(alerts).toEqual([]);
    expect(updates()).toEqual([
      expect.objectContaining({
        transferId: request.transferId,
        revision: 1,
        status: "denied",
        reason: "Transfers are paused.",
        fee: 1_000,
        sendAmount: 101_000,
      }),
    ]);
    expect((await stored(request.transferId)).update?.status).toBe("denied");
  });

  it("keeps the first request of a transfer id, whoever sends it again", async () => {
    const { send, stored, user } = setup();
    const request = sendRequest();
    await send(request);
    await send({ ...request, amount: 250_000 }, makeIdentity().pubkey);
    expect(await stored(request.transferId)).toMatchObject({
      user,
      amount: 100_000,
    });
  });
});

describe("transfer log", () => {
  it("keeps every transfer message a user sent, raw and once, whether it decodes or not", async () => {
    const { send, transferMessages, user, nostr } = setup();
    const request = sendRequest();
    await send(request);
    const garbled = new AppMessageReceived({
      ...transferMessageFrom(user, request),
      content: '{"type":"request","amount":"lots"}',
    });
    await deliver(nostr.inbox, garbled);
    await deliver(nostr.inbox, garbled);
    const log = await Effect.runPromise(readTransferLog(transferMessages));
    expect(log).toMatchObject([
      { from: user, transferId: request.transferId },
      { from: user, transferId: null, content: garbled.content },
    ]);
    expect(log[0]?.content).toContain(request.transferId);
  });
});

describe("cancelling", () => {
  it("cancels a request its user withdrew before it was accepted", async () => {
    const { send, stored, updates } = setup();
    const request = sendRequest();
    await send(request);
    await send({ v: 1, type: "cancel", transferId: request.transferId });
    expect(updates().at(-1)).toMatchObject({
      status: "cancelled",
      reason: "Cancelled by the user.",
    });
    expect(
      (await stored(request.transferId)).userCancelledAtSec,
    ).not.toBeNull();
  });

  it("cancels an accepted transfer and ignores a cancel from anyone else", async () => {
    const { transfers, send, updates } = setup();
    const request = sendRequest();
    await send(request);
    await transfers.accept(request.transferId);
    await send(
      { v: 1, type: "cancel", transferId: request.transferId },
      makeIdentity().pubkey,
    );
    expect(updates().map((update) => update.status)).toEqual(["accepted"]);
    await send({ v: 1, type: "cancel", transferId: request.transferId });
    expect(updates().map((update) => update.status)).toEqual([
      "accepted",
      "cancelled",
    ]);
  });

  it("only records the cancel once the deposit was seen", async () => {
    const { transfers, send, stored, updates, esplora, user, alerts } = setup();
    const request = receiveRequest(user);
    await send(request);
    await transfers.accept(request.transferId);
    const address = (await stored(request.transferId)).depositAddress ?? "";
    esplora.state.byAddress.set(address, [
      txPaying("aa".repeat(32), address, 100_000),
    ]);
    await transfers.checkDeposits();
    await send({ v: 1, type: "cancel", transferId: request.transferId });
    await send({ v: 1, type: "cancel", transferId: request.transferId });
    expect(alerts).toEqual(["requested", "cancelledAfterFunds"]);
    expect(updates().map((update) => update.status)).toEqual([
      "accepted",
      "fundsSeen",
    ]);
    expect(
      (await stored(request.transferId)).userCancelledAtSec,
    ).not.toBeNull();
  });
});

describe("accepting", () => {
  it("asks the user to pay the amount plus the fee at the mint, to the operator, by transfer id", async () => {
    const { transfers, send, stored, updates, nostr } = setup();
    const request = sendRequest();
    await send(request);
    expect(await transfers.accept(request.transferId)).toBeNull();
    const [accepted] = updates();
    expect(accepted).toMatchObject({ revision: 1, status: "accepted" });
    const paymentRequest = decodePaymentRequest(accepted?.paymentRequest ?? "");
    expect(paymentRequest).toMatchObject({
      amount: 101_000,
      id: request.transferId,
      mints: [testMint],
      transports: [{ type: "nostr", target: nostr.nostr.nprofile }],
    });
    expect((await stored(request.transferId)).operatorPaymentRequest).toBe(
      accepted?.paymentRequest,
    );
    expect(nostr.appMessages[0]?.draft.to).toBe(
      (await stored(request.transferId)).user,
    );
    expect(await transfers.accept(request.transferId)).toEqual({
      reason: "notAllowed",
    });
  });

  it("gives every on-chain receive the next deposit address", async () => {
    const { transfers, send, stored, updates, user } = setup();
    const first = receiveRequest(user);
    const second = receiveRequest(user);
    await send(first);
    await send(second);
    await transfers.accept(first.transferId);
    await transfers.accept(second.transferId);
    const address = (index: number) =>
      deriveDepositAddress({ xpub: tpub, index, network: "regtest" });
    expect(await stored(first.transferId)).toMatchObject({
      addressIndex: 0,
      depositAddress: address(0),
    });
    expect(await stored(second.transferId)).toMatchObject({
      addressIndex: 1,
      depositAddress: address(1),
    });
    expect(updates().map((update) => update.depositAddress)).toEqual([
      address(0),
      address(1),
    ]);
  });

  it("skips deposit addresses that already have on-chain history, and accepts nothing while Esplora cannot tell", async () => {
    const { transfers, send, stored, esplora, user } = setup();
    const address = (index: number) =>
      deriveDepositAddress({ xpub: tpub, index, network: "regtest" });
    esplora.state.byAddress.set(address(0), [
      txPaying("aa".repeat(32), address(0), 1_000, 50),
    ]);
    const first = receiveRequest(user);
    const second = receiveRequest(user);
    await send(first);
    await send(second);
    expect(await transfers.accept(first.transferId)).toBeNull();
    expect(await stored(first.transferId)).toMatchObject({
      addressIndex: 1,
      depositAddress: address(1),
    });
    esplora.state.offline = true;
    expect(await transfers.accept(second.transferId)).toEqual({
      reason: "addressUnchecked",
    });
    expect((await stored(second.transferId)).update).toBeNull();
  });

  it("needs a key of the network to accept an on-chain receive", async () => {
    const { transfers, send, user } = setup({
      profile: { ...profile, xpub: "xpub-of-another-network" },
    });
    const request = receiveRequest(user);
    await send(request);
    expect(await transfers.accept(request.transferId)).toEqual({
      reason: "noProfile",
    });
  });
});

describe("ecash in", () => {
  const acceptedSend = async (wallet?: ReturnType<typeof fakeWallet>) => {
    const context = setup(wallet === undefined ? {} : { wallet });
    const request = sendRequest();
    await context.send(request);
    await context.transfers.accept(request.transferId);
    const pay = (amount: number) =>
      deliver(
        context.nostr.inbox,
        chatTextFrom(context.user, nut18Payload(request.transferId, amount)),
      );
    return { ...context, request, pay };
  };

  it("receives the payment naming the transfer and reports the funds received", async () => {
    const { pay, updates, wallet, alerts } = await acceptedSend(
      fakeWallet(() => Result.succeed(receiveReceipt(101_000))),
    );
    await pay(101_000);
    expect(wallet.received).toHaveLength(1);
    expect(alerts).toEqual(["requested", "payoutDue"]);
    expect(updates().at(-1)).toMatchObject({
      revision: 2,
      status: "fundsReceived",
      receivedAmount: 101_000,
      paymentRequest: updates()[0]?.paymentRequest,
    });
  });

  it("receives the amount without the fee without moving the transfer on", async () => {
    const { pay, updates } = await acceptedSend(
      fakeWallet(() => Result.succeed(receiveReceipt(100_000))),
    );
    await pay(100_000);
    expect(updates().map((update) => update.status)).toEqual(["accepted"]);
  });

  it("pays one transfer with ecash, never again and never another one, and leaves a deferred one for the next session", async () => {
    let known = false;
    const wallet = fakeWallet(() => {
      if (known)
        return Result.fail(
          new TokenAlreadyKnown({ operationId: OperationId.make("receive-1") }),
        );
      known = true;
      return Result.succeed(receiveReceipt(101_000));
    });
    const context = setup({ wallet });
    const [paid, other] = [sendRequest(), sendRequest()];
    for (const request of [paid, other]) {
      await context.send(request);
      await context.transfers.accept(request.transferId);
    }
    for (const id of [paid.transferId, paid.transferId, other.transferId])
      await deliver(
        context.nostr.inbox,
        chatTextFrom(context.user, nut18Payload(id, 101_000)),
      );
    expect((await context.stored(paid.transferId)).update?.status).toBe(
      "fundsReceived",
    );
    expect((await context.stored(other.transferId)).update?.status).toBe(
      "accepted",
    );

    const deferred = await acceptedSend(
      fakeWallet(() =>
        Result.fail(
          new ReceiveDeferred({
            mint: MintUrl.make(testMint),
            operationId: OperationId.make("receive-2"),
            amount: Amount.make(101_000),
          }),
        ),
      ),
    );
    await expect(deferred.pay(101_000)).rejects.toBeInstanceOf(ReceiveDeferred);
  });

  it("keeps ecash from another mint without counting it toward the transfer", async () => {
    const otherMint = "https://own.mint.example";
    const { nostr, user, request, updates, wallet } = await acceptedSend(
      fakeWallet(() =>
        Result.succeed(receiveReceipt(101_000, "receive-1", otherMint)),
      ),
    );
    await deliver(
      nostr.inbox,
      chatTextFrom(user, nut18Payload(request.transferId, 101_000, otherMint)),
    );
    expect(wallet.received).toHaveLength(1);
    expect(updates().map((update) => update.status)).toEqual(["accepted"]);
  });

  it("receives ecash naming no transfer without touching any transfer", async () => {
    const { nostr, user, updates, wallet } = await acceptedSend();
    await deliver(
      nostr.inbox,
      chatTextFrom(user, nut18Payload("other", 101_000)),
    );
    expect(wallet.received).toHaveLength(1);
    expect(updates()).toHaveLength(1);
  });
});

describe("deposit watcher", () => {
  it("reports the deposit as it confirms, then as received", async () => {
    const { transfers, send, stored, updates, esplora, user, alerts } = setup();
    const request = receiveRequest(user);
    await send(request);
    await transfers.accept(request.transferId);
    const address = (await stored(request.transferId)).depositAddress ?? "";
    const txid = "bb".repeat(32);

    await transfers.checkDeposits();
    esplora.state.byAddress.set(address, [txPaying(txid, address, 101_000)]);
    await transfers.checkDeposits();
    await transfers.checkDeposits();
    esplora.state.byAddress.set(address, [
      txPaying(txid, address, 101_000, 100),
    ]);
    await transfers.checkDeposits();
    esplora.state.tipHeight = 101;
    await transfers.checkDeposits();
    await transfers.checkDeposits();

    expect(
      updates().map(({ status, confirmations, revision }) => ({
        status,
        confirmations,
        revision,
      })),
    ).toEqual([
      { status: "accepted", confirmations: undefined, revision: 1 },
      { status: "fundsSeen", confirmations: 0, revision: 2 },
      { status: "fundsSeen", confirmations: 1, revision: 3 },
      { status: "fundsReceived", confirmations: 2, revision: 4 },
    ]);
    expect(alerts).toEqual(["requested", "ecashDue"]);
    expect(updates().at(-1)).toMatchObject({
      txid,
      receivedAmount: 101_000,
      depositAddress: address,
    });
  });

  it("leaves alone a deposit address two transfers were given", async () => {
    const { transfers, repository, send, stored, updates, esplora, user } =
      setup();
    const first = receiveRequest(user);
    const second = receiveRequest(user);
    await send(first);
    await send(second);
    await transfers.accept(first.transferId);
    await transfers.accept(second.transferId);
    const address = (await stored(first.transferId)).depositAddress ?? "";
    // What syncs when two devices accepted before seeing each other.
    await Effect.runPromise(
      repository.update(second.transferId, {
        depositAddress: NonEmptyString1000.orThrow(address),
        addressIndex: NonNegativeInt.orThrow(0),
      }),
    );
    esplora.state.byAddress.set(address, [
      txPaying("bb".repeat(32), address, 100_000, 99),
    ]);
    await transfers.checkDeposits();
    expect(updates().map((update) => update.status)).toEqual([
      "accepted",
      "accepted",
    ]);
  });
});

describe("payouts", () => {
  it("completes an on-chain send once the transaction pays the payout address", async () => {
    const wallet = fakeWallet(() => Result.succeed(receiveReceipt(101_000)));
    const { transfers, send, nostr, user, updates, esplora } = setup({
      wallet,
    });
    const request = sendRequest();
    await send(request);
    await transfers.accept(request.transferId);
    await deliver(
      nostr.inbox,
      chatTextFrom(user, nut18Payload(request.transferId, 101_000)),
    );

    const short = "cc".repeat(32);
    const paid = "dd".repeat(32);
    esplora.state.byTxid.set(short, txPaying(short, payoutAddress, 99_000));
    esplora.state.byTxid.set(paid, txPaying(paid, payoutAddress, 100_000));
    expect(await transfers.confirmPayout(request.transferId, "nope")).toEqual({
      reason: "invalidTxid",
    });
    expect(
      await transfers.confirmPayout(request.transferId, "ee".repeat(32)),
    ).toEqual({
      reason: "txUnavailable",
    });
    expect(await transfers.confirmPayout(request.transferId, short)).toEqual({
      reason: "txShort",
      paid: 99_000,
    });
    expect(
      await transfers.confirmPayout(request.transferId, paid.toUpperCase()),
    ).toBeNull();
    expect(updates().at(-1)).toMatchObject({ status: "completed", txid: paid });
  });

  const fundedSend = async (context: ReturnType<typeof setup>) => {
    const request = sendRequest();
    await context.send(request);
    await context.transfers.accept(request.transferId);
    await deliver(
      context.nostr.inbox,
      chatTextFrom(context.user, nut18Payload(request.transferId, 101_000)),
    );
    return request;
  };

  it("takes no payout transaction while the ecash refund is on its way", async () => {
    const context = setup({
      wallet: fakeWallet(() => Result.succeed(receiveReceipt(101_000))),
    });
    const request = await fundedSend(context);
    const paid = "dd".repeat(32);
    context.esplora.state.byTxid.set(
      paid,
      txPaying(paid, payoutAddress, 100_000),
    );
    expect(await context.transfers.refundEcash(request.transferId)).toBeNull();
    expect(
      await context.transfers.confirmPayout(request.transferId, paid),
    ).toEqual({
      reason: "inFlight",
    });
    expect(context.updates().at(-1)?.status).toBe("fundsReceived");
  });

  it("does not let one payout transaction complete two transfers", async () => {
    const context = setup({
      wallet: fakeWallet(() => Result.succeed(receiveReceipt(101_000))),
    });
    const first = await fundedSend(context);
    const second = await fundedSend(context);
    const paid = "dd".repeat(32);
    context.esplora.state.byTxid.set(
      paid,
      txPaying(paid, payoutAddress, 100_000),
    );
    expect(
      await context.transfers.confirmPayout(first.transferId, paid),
    ).toBeNull();
    expect(
      await context.transfers.confirmPayout(second.transferId, paid),
    ).toEqual({
      reason: "txidReused",
    });
    expect((await context.stored(second.transferId)).update?.status).toBe(
      "fundsReceived",
    );
  });

  const receivedDeposit = async () => {
    const context = setup();
    const request = receiveRequest(context.user);
    await context.send(request);
    await context.transfers.accept(request.transferId);
    const address =
      (await context.stored(request.transferId)).depositAddress ?? "";
    context.esplora.state.byAddress.set(address, [
      txPaying("bb".repeat(32), address, 101_000, 99),
    ]);
    await context.transfers.checkDeposits();
    return { ...context, request };
  };

  it("pays the user's request over its Nostr transport and completes once it left", async () => {
    const { transfers, request, nostr, wallet, updates, user } =
      await receivedDeposit();
    expect(await transfers.sendEcash(request.transferId)).toBeNull();
    expect(wallet.sent).toEqual([{ amount: 100_000, forRequest: true }]);
    const [sent] = nostr.tokens;
    expect(sent?.to).toBe(user);
    expect(sent?.relays).toEqual([RelayUrl.make("ws://localhost:7777")]);
    expect(decodePaymentRequestPayload(sent?.token ?? "")).toMatchObject({
      requestId: request.transferId,
      amount: 100_000,
      mint: testMint,
    });
    expect(await transfers.sendEcash(request.transferId)).toEqual({
      reason: "inFlight",
    });
    expect(updates().at(-1)?.status).toBe("fundsReceived");

    await settle(nostr, succeeded(sent?.ref ?? ""));
    expect(wallet.forgotten).toEqual(["send-1"]);
    expect(updates().at(-1)).toMatchObject({ status: "completed" });
    expect(nostr.notices).toEqual([user]);
  });

  it("keeps a confirmed deposit short of the amount plus the fee seen, alerts once and pays nothing", async () => {
    const context = setup();
    const request = receiveRequest(context.user);
    await context.send(request);
    await context.transfers.accept(request.transferId);
    const address =
      (await context.stored(request.transferId)).depositAddress ?? "";
    context.esplora.state.byAddress.set(address, [
      txPaying("bb".repeat(32), address, 100_000, 99),
    ]);
    await context.transfers.checkDeposits();
    context.esplora.state.tipHeight = 101;
    await context.transfers.checkDeposits();
    expect(context.updates().at(-1)).toMatchObject({
      status: "fundsSeen",
      confirmations: 2,
      receivedAmount: 100_000,
    });
    expect(context.updates()).toHaveLength(2);
    expect(context.alerts).toEqual(["requested", "ecashDue"]);
    expect(await context.transfers.sendEcash(request.transferId)).toEqual({
      reason: "notAllowed",
    });
    expect(context.wallet.sent).toEqual([]);
  });

  it("takes no refund transaction while the ecash payout is on its way", async () => {
    const { transfers, request, esplora } = await receivedDeposit();
    const refund = "ff".repeat(32);
    esplora.state.byTxid.set(refund, txPaying(refund, "bcrt1qsender", 1));
    await transfers.sendEcash(request.transferId);
    expect(
      await transfers.confirmRefund(request.transferId, "ff".repeat(32)),
    ).toEqual({
      reason: "inFlight",
    });
  });

  it("takes the ecash back when its message could not be sent", async () => {
    const { transfers, request, nostr, wallet, updates } =
      await receivedDeposit();
    await transfers.sendEcash(request.transferId);
    const ref = nostr.tokens[0]?.ref ?? "";
    await settle(
      nostr,
      new OutboxJobFailed({
        jobId: OutboxJobId.make("job"),
        ref: OutboxRef.make(ref),
        reason: "unexpected-error",
        detail: "",
      }),
    );
    expect(wallet.returned).toEqual(["send-1"]);
    expect(updates().at(-1)?.status).toBe("fundsReceived");
  });

  it("keeps another device from paying while the Cashu is on its way", async () => {
    const first = await receivedDeposit();
    const second = setup({ store: first.store });
    expect(
      await first.transfers.sendEcash(first.request.transferId),
    ).toBeNull();
    expect(await second.transfers.sendEcash(first.request.transferId)).toEqual({
      reason: "inFlight",
    });
    const refund = "ff".repeat(32);
    second.esplora.state.byTxid.set(
      refund,
      txPaying(refund, "bcrt1qsender", 1),
    );
    expect(
      await second.transfers.confirmRefund(first.request.transferId, refund),
    ).toEqual({ reason: "inFlight" });
    expect(second.wallet.sent).toEqual([]);
  });

  it("takes back Cashu a gone device queued, so its late message completes nothing", async () => {
    const first = await receivedDeposit();
    const second = setup({
      store: first.store,
      wallet: fakeWallet(undefined, "other-send"),
    });
    const id = first.request.transferId;
    await first.transfers.sendEcash(id);
    expect(await second.transfers.takeBackEcash(id)).toBeNull();
    expect(second.wallet.returned).toEqual(["send-1"]);
    expect((await first.stored(id)).ecashSendId).toBeNull();

    expect(await second.transfers.sendEcash(id)).toBeNull();
    await settle(first.nostr, succeeded(first.nostr.tokens[0]?.ref ?? ""));
    expect((await first.stored(id)).update?.status).toBe("fundsReceived");
    expect(first.nostr.notices).toEqual([]);

    await settle(second.nostr, succeeded(second.nostr.tokens[0]?.ref ?? ""));
    expect((await first.stored(id)).update?.status).toBe("completed");
  });

  it("completes the transfer when the Cashu taken back was already claimed", async () => {
    const { transfers, request, wallet, stored } = await receivedDeposit();
    await transfers.sendEcash(request.transferId);
    wallet.takeBackOutcome = "claimed";
    expect(await transfers.takeBackEcash(request.transferId)).toBeNull();
    expect(await stored(request.transferId)).toMatchObject({
      ecashSendId: null,
      update: { status: "completed" },
    });
  });

  it("keeps the send while the mint cannot take back Cashu whose message failed", async () => {
    const { transfers, request, nostr, wallet, stored } =
      await receivedDeposit();
    await transfers.sendEcash(request.transferId);
    const failed = new OutboxJobFailed({
      jobId: OutboxJobId.make("job"),
      ref: OutboxRef.make(nostr.tokens[0]?.ref ?? ""),
      reason: "unexpected-error",
      detail: "",
    });
    wallet.takeBackOutcome = "mintUnreachable";
    await expect(settle(nostr, failed)).rejects.toThrow();
    expect((await stored(request.transferId)).ecashSendId).toBe("send-1");
    wallet.takeBackOutcome = "returned";
    await settle(nostr, failed);
    expect((await stored(request.transferId)).ecashSendId).toBeNull();
  });

  it("completes the transfer when Cashu whose message failed was already claimed", async () => {
    const { transfers, request, nostr, wallet, stored } =
      await receivedDeposit();
    await transfers.sendEcash(request.transferId);
    wallet.takeBackOutcome = "claimed";
    await settle(
      nostr,
      new OutboxJobFailed({
        jobId: OutboxJobId.make("job"),
        ref: OutboxRef.make(nostr.tokens[0]?.ref ?? ""),
        reason: "unexpected-error",
        detail: "",
      }),
    );
    expect(await stored(request.transferId)).toMatchObject({
      ecashSendId: null,
      update: { status: "completed" },
    });
  });

  it("refunds an on-chain receive by the transaction the operator pasted, with what it returned to the sender", async () => {
    const { transfers, request, updates, esplora, stored } =
      await receivedDeposit();
    const sender = "bcrt1qsender";
    const address = (await stored(request.transferId)).depositAddress ?? "";
    esplora.state.byAddress.set(address, [
      {
        ...txPaying("bb".repeat(32), address, 101_000, 99),
        vin: [{ prevout: { scriptpubkey_address: sender } }],
      },
    ]);
    const refund = "ff".repeat(32);
    expect(await transfers.confirmRefund(request.transferId, refund)).toEqual({
      reason: "txUnavailable",
    });
    esplora.state.byTxid.set(refund, txPaying(refund, sender, 100_500));
    expect(
      await transfers.confirmRefund(request.transferId, refund),
    ).toBeNull();
    expect(updates().at(-1)).toMatchObject({
      status: "refunded",
      refundTxid: refund,
      refundAmount: 100_500,
    });
  });

  it("refunds an on-chain send by sending the received ecash back", async () => {
    const wallet = fakeWallet(() => Result.succeed(receiveReceipt(101_000)));
    const { transfers, send, nostr, user, updates } = setup({ wallet });
    const request = sendRequest();
    await send(request);
    await transfers.accept(request.transferId);
    await deliver(
      nostr.inbox,
      chatTextFrom(user, nut18Payload(request.transferId, 101_000)),
    );
    expect(await transfers.refundEcash(request.transferId)).toBeNull();
    expect(wallet.sent).toEqual([{ amount: 101_000, forRequest: false }]);
    expect(nostr.tokens[0]).toMatchObject({ to: user });
    await settle(nostr, succeeded(nostr.tokens[0]?.ref ?? ""));
    expect(updates().at(-1)).toMatchObject({
      status: "refunded",
      refundAmount: 101_000,
    });
  });
});
