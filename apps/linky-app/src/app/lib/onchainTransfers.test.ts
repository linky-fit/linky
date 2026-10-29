import {
  decodePaymentRequest,
  PaymentRequestId,
} from "@linky-fit/linkshu/payment-request";
import {
  createId,
  makeOnchainTransfersRepository,
  NonEmptyString1000,
  PositiveInt,
  sqliteTrue,
} from "@linky-fit/linksync";
import {
  AppDataEvent,
  EventId,
  Pubkey,
  SignedPlainEvent,
  UnixSeconds,
} from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import {
  encodeTransferUpdateColumn,
  ONCHAIN_CONFIG_IDENTIFIER,
  onchainConfigDraft,
  type OnchainConfig,
  type OnchainTransferUpdate,
} from "@linky-fit/onchain-transfer";
import { Effect } from "effect";
import { nip19 } from "nostr-tools";
import { describe, expect, it } from "vitest";
import { makeTestLinkyStore } from "../../testUtils/linkyStore";
import {
  MAINNET_ADDRESS,
  REGTEST_ADDRESS,
  onchainConfigFixture,
  onchainTransferUpdateFixture,
  onchainTransferViewFixture,
} from "../../testUtils/onchainTransfers";
import {
  newestOnchainConfig,
  newOnchainTransferProblem,
  onchainSendPaymentRequest,
  onchainTransferView,
  openOnchainReceive,
  planOnchainTransfer,
  onchainPayoutTarget,
  onchainTransferUpdatePatch,
  unfinishedOnchainTransfers,
  type NewOnchainTransferDraft,
  type OnchainTransferView,
} from "./onchainTransfers";
import { buildCashuPaymentRequestMessage } from "./paymentRequestMessage";

const operator = makeIdentity().pubkey;
const config = onchainConfigFixture();
const NOW = 1_700_000_000;

const send: NewOnchainTransferDraft = {
  direction: "send",
  amount: 100_000,
  payoutAddress: REGTEST_ADDRESS,
};
const receive: NewOnchainTransferDraft = {
  direction: "receive",
  amount: null,
  payoutAddress: "",
};

type OnchainTransferIdOf = ReturnType<typeof createId<"OnchainTransfer">>;

const userNprofile = nip19.nprofileEncode({
  pubkey: makeIdentity().pubkey,
  relays: [],
});

interface StoredOnchainTransferOptions {
  readonly update?: (id: OnchainTransferIdOf) => OnchainTransferUpdate;
  /** The amount of the user's own request, for an on-chain receive of a fixed amount; none leaves it to the deposit. */
  readonly requestAmount?: number;
  readonly received?: number;
  readonly sentAtSec?: number;
  /** When the payment history paid the operator's request. */
  readonly paidAtSec?: number;
  readonly cancelledAtSec?: number;
  readonly peer?: Pubkey;
}

/** Stores the planned transfer with what happened to it since, and reads it back as a view. */
const storedOnchainTransfer = (
  draft: NewOnchainTransferDraft,
  options: StoredOnchainTransferOptions = {},
) => {
  const transfers = makeOnchainTransfersRepository(makeTestLinkyStore().store);
  const id = createId<"OnchainTransfer">();
  const planned = planOnchainTransfer({
    draft,
    config,
    id,
    nowSec: NOW,
    operator: options.peer ?? operator,
    userPaymentRequest:
      draft.direction === "receive"
        ? buildCashuPaymentRequestMessage({
            amount: options.requestAmount ?? null,
            mintUrls: [config.mintUrl],
            recipientNprofile: userNprofile,
            requestId: PaymentRequestId.make(id),
          })
        : null,
  });
  if (planned === null) throw new Error("unplannable draft");
  Effect.runSync(transfers.insert(planned.row));
  const { update, sentAtSec, cancelledAtSec } = options;
  Effect.runSync(
    transfers.update(id, {
      ...(update === undefined
        ? {}
        : {
            updateJson: NonEmptyString1000.orThrow(
              encodeTransferUpdateColumn(update(id)),
            ),
          }),
      ...(sentAtSec === undefined
        ? {}
        : { sentAtSec: PositiveInt.orThrow(sentAtSec) }),
      ...(cancelledAtSec === undefined
        ? {}
        : { cancelledAtSec: PositiveInt.orThrow(cancelledAtSec) }),
    }),
  );
  const [record] = Effect.runSync(transfers.all);
  const byRequestId = (value: number | undefined) =>
    new Map(value === undefined ? [] : [[PaymentRequestId.make(id), value]]);
  return onchainTransferView(record, operator, {
    paidAtSec: byRequestId(options.paidAtSec),
    received: byRequestId(options.received),
  });
};

const accepted = (id: OnchainTransferIdOf) => onchainTransferUpdateFixture(id);

describe("onchainTransferView", () => {
  it("waits for the operator until an update arrives, at the fee the request was made at, on top of the amount", () => {
    expect(storedOnchainTransfer(send)).toMatchObject({
      phase: "waitingForDetails",
      amount: 100_000,
      fee: 1_000,
      sendAmount: 101_000,
      payoutAddress: REGTEST_ADDRESS,
    });
  });

  it("is sent once the user paid, accepted or not, and ready to send once accepted unpaid", () => {
    expect(storedOnchainTransfer(send, { sentAtSec: NOW })?.phase).toBe("sent");
    expect(storedOnchainTransfer(send, { update: accepted })?.phase).toBe(
      "readyToSend",
    );
    expect(
      storedOnchainTransfer(send, { update: accepted, sentAtSec: NOW })?.phase,
    ).toBe("sent");
  });

  it("is sent once the payment history paid the operator's request, though the sent time was never stored", () => {
    expect(
      storedOnchainTransfer(send, { update: accepted, paidAtSec: NOW })?.phase,
    ).toBe("sent");
  });

  it("holds a receive of any amount at the config's minimum until the deposit sets the terms", () => {
    expect(storedOnchainTransfer(receive)).toMatchObject({
      phase: "waitingForDetails",
      anyAmount: true,
      amount: 100_000,
      fee: 1_000,
      sendAmount: 101_000,
    });
    const deposited = storedOnchainTransfer(receive, {
      update: (id) =>
        onchainTransferUpdateFixture(id, {
          status: "fundsSeen",
          fee: 1_486,
          sendAmount: 150_000,
          receivedAmount: 150_000,
        }),
    });
    expect(deposited).toMatchObject({
      phase: "depositSeen",
      amount: 148_514,
      fee: 1_486,
      sendAmount: 150_000,
    });
  });

  it("completes an on-chain receive once the request named by the transfer id received what the terms give", () => {
    const update = (id: OnchainTransferIdOf) =>
      onchainTransferUpdateFixture(id, {
        status: "fundsReceived",
        fee: 1_486,
        sendAmount: 150_000,
        receivedAmount: 150_000,
      });
    expect(storedOnchainTransfer(receive, { update })?.phase).toBe(
      "waitingForEcash",
    );
    expect(
      storedOnchainTransfer(receive, { update, received: 148_513 })?.phase,
    ).toBe("waitingForEcash");
    expect(
      storedOnchainTransfer(receive, { update, received: 148_514 })?.phase,
    ).toBe("completed");
  });

  it("completes a receive of a fixed amount only at the amount of the user's own request", () => {
    const update = (id: OnchainTransferIdOf) =>
      onchainTransferUpdateFixture(id, {
        status: "fundsReceived",
        fee: 0,
        sendAmount: 1,
      });
    const fixed = storedOnchainTransfer(receive, {
      update,
      requestAmount: 100_000,
      received: 1,
    });
    expect(fixed).toMatchObject({ phase: "waitingForEcash", anyAmount: false });
  });

  it("shows a cancel the user sent before funds moved, and the locked fee of the update", () => {
    expect(
      storedOnchainTransfer(send, {
        update: (id) =>
          onchainTransferUpdateFixture(id, { fee: 500, sendAmount: 100_500 }),
        cancelledAtSec: NOW,
      }),
    ).toMatchObject({ phase: "cancelled", fee: 500, sendAmount: 100_500 });
  });

  it("skips transfers with another peer", () => {
    expect(
      storedOnchainTransfer(send, { peer: makeIdentity().pubkey }),
    ).toBeNull();
  });
});

describe("unfinishedOnchainTransfers", () => {
  it("keeps the running transfers, newest first", () => {
    const older = onchainTransferViewFixture({
      createdAtSec: 1,
      phase: "sent",
    });
    const newer = onchainTransferViewFixture({
      createdAtSec: 2,
      phase: "readyToSend",
    });
    const finished = (
      ["completed", "denied", "cancelled", "refunded"] as const
    ).map((phase) => onchainTransferViewFixture({ createdAtSec: 3, phase }));
    expect(unfinishedOnchainTransfers([older, ...finished, newer])).toEqual([
      newer,
      older,
    ]);
  });
});

describe("openOnchainReceive", () => {
  const waiting = (overrides: Partial<OnchainTransferView>) =>
    onchainTransferViewFixture({
      direction: "receive",
      anyAmount: true,
      phase: "awaitingDeposit",
      ...overrides,
    });

  it("finds the newest receive of any amount still waiting for its deposit", () => {
    const older = waiting({ createdAtSec: 1, phase: "waitingForDetails" });
    const newer = waiting({ createdAtSec: 2 });
    const seen = waiting({ createdAtSec: 3, phase: "depositSeen" });
    const fixed = waiting({ createdAtSec: 4, anyAmount: false });
    const send = onchainTransferViewFixture({ createdAtSec: 5 });
    expect(openOnchainReceive([older, seen, fixed, send, newer])).toBe(newer);
    expect(openOnchainReceive([seen, fixed, send])).toBeNull();
  });
});

describe("onchainPayoutTarget", () => {
  it("reads a bare address or a BIP21 URI's address and amount on any network", () => {
    expect(onchainPayoutTarget(` ${MAINNET_ADDRESS} `)).toEqual({
      address: MAINNET_ADDRESS,
      amountSat: null,
    });
    expect(
      onchainPayoutTarget(`bitcoin:${REGTEST_ADDRESS}?amount=0.0025&label=x`),
    ).toEqual({ address: REGTEST_ADDRESS, amountSat: 250_000 });
  });

  it("takes nothing that is not a bitcoin address", () => {
    expect(onchainPayoutTarget("bitcoin:?lightning=lnbc1")).toBeNull();
    expect(onchainPayoutTarget("bc1notanaddress")).toBeNull();
    expect(onchainPayoutTarget("alice@example.com")).toBeNull();
  });
});

describe("newOnchainTransferProblem", () => {
  it("accepts a payout address of the config's network only", () => {
    expect(newOnchainTransferProblem(send, config)).toBeNull();
    expect(
      newOnchainTransferProblem(
        { ...send, payoutAddress: MAINNET_ADDRESS },
        config,
      ),
    ).toBe("payoutAddressInvalid");
    expect(
      newOnchainTransferProblem({ ...send, payoutAddress: " " }, config),
    ).toBe("payoutAddressMissing");
  });

  it("takes a send only for one of the config's amounts and nothing while paused", () => {
    expect(
      newOnchainTransferProblem({ ...send, amount: 123_456 }, config),
    ).toBe("amountMissing");
    expect(newOnchainTransferProblem({ ...send, amount: null }, config)).toBe(
      "amountMissing",
    );
    expect(
      newOnchainTransferProblem(send, onchainConfigFixture({ paused: true })),
    ).toBe("paused");
  });

  it("takes a receive of any amount only from an operator naming a minimum", () => {
    expect(newOnchainTransferProblem(receive, config)).toBeNull();
    expect(
      newOnchainTransferProblem(
        receive,
        onchainConfigFixture({ minReceiveAmount: undefined }),
      ),
    ).toBe("anyAmountUnavailable");
  });
});

describe("planOnchainTransfer", () => {
  const id = createId<"OnchainTransfer">();

  it("stores and sends the payout address as Esplora reports it, a bech32 one in lowercase", () => {
    expect(
      planOnchainTransfer({
        draft: { ...send, payoutAddress: REGTEST_ADDRESS.toUpperCase() },
        config,
        id,
        nowSec: NOW,
        operator,
        userPaymentRequest: null,
      })?.row,
    ).toMatchObject({ payoutAddress: REGTEST_ADDRESS });
  });

  it("requests an on-chain send with the payout address at the config's fee", () => {
    const planned = planOnchainTransfer({
      draft: { ...send, payoutAddress: ` ${REGTEST_ADDRESS} ` },
      config,
      id,
      nowSec: NOW,
      operator,
      userPaymentRequest: null,
    });
    expect(planned?.request).toEqual({
      v: 1,
      type: "request",
      transferId: id,
      direction: "send",
      amount: 100_000,
      feeBasisPoints: 100,
      payoutAddress: REGTEST_ADDRESS,
    });
    expect(planned?.row).toEqual({
      id,
      createdAtSec: NOW,
      role: "user",
      peerPubkey: operator,
      direction: "send",
      amount: 100_000,
      feeBasisPoints: 100,
      payoutAddress: REGTEST_ADDRESS,
    });
  });

  it("requests an on-chain receive of any amount, refunded to the sender, holding the minimum until the deposit", () => {
    const planned = planOnchainTransfer({
      draft: receive,
      config,
      id,
      nowSec: NOW,
      operator,
      userPaymentRequest: "creqAtest",
    });
    expect(planned?.request).toEqual({
      v: 1,
      type: "request",
      transferId: id,
      direction: "receive",
      feeBasisPoints: 100,
      refund: { to: "sender" },
      paymentRequest: "creqAtest",
    });
    expect(planned?.row).toEqual({
      id,
      createdAtSec: NOW,
      role: "user",
      peerPubkey: operator,
      direction: "receive",
      amount: 100_000,
      feeBasisPoints: 100,
      refundToSender: sqliteTrue,
      userPaymentRequest: "creqAtest",
    });
  });

  it("refuses an on-chain receive without the user's payment request or a minimum to hold", () => {
    expect(
      planOnchainTransfer({
        draft: receive,
        config,
        id,
        nowSec: NOW,
        operator,
        userPaymentRequest: null,
      }),
    ).toBeNull();
    expect(
      planOnchainTransfer({
        draft: receive,
        config: onchainConfigFixture({ minReceiveAmount: undefined }),
        id,
        nowSec: NOW,
        operator,
        userPaymentRequest: "creqAtest",
      }),
    ).toBeNull();
  });
});

describe("onchainTransferUpdatePatch", () => {
  const id = createId<"OnchainTransfer">();
  const row = { role: "user", peerPubkey: operator, updateJson: null };

  it("stores a newer update with the deposit address and the operator's request", () => {
    const update = onchainTransferUpdateFixture(id, {
      depositAddress: REGTEST_ADDRESS,
      paymentRequest: "creqAoperator",
    });
    expect(onchainTransferUpdatePatch(row, operator, update)).toEqual({
      updateJson: encodeTransferUpdateColumn(update),
      depositAddress: REGTEST_ADDRESS,
      operatorPaymentRequest: "creqAoperator",
    });
  });

  it("changes nothing for a replayed or older revision", () => {
    const stored = {
      ...row,
      updateJson: encodeTransferUpdateColumn(
        onchainTransferUpdateFixture(id, { revision: 2 }),
      ),
    };
    expect(
      onchainTransferUpdatePatch(
        stored,
        operator,
        onchainTransferUpdateFixture(id, { revision: 2 }),
      ),
    ).toBeNull();
    expect(
      onchainTransferUpdatePatch(
        stored,
        operator,
        onchainTransferUpdateFixture(id, { revision: 1 }),
      ),
    ).toBeNull();
    expect(
      onchainTransferUpdatePatch(
        stored,
        operator,
        onchainTransferUpdateFixture(id, {
          revision: 3,
          status: "fundsReceived",
        }),
      ),
    ).not.toBeNull();
  });

  it("changes nothing on a transfer of another peer or the operator's own row", () => {
    const update = onchainTransferUpdateFixture(id);
    const stranger = Pubkey.make(makeIdentity().pubkey);
    expect(onchainTransferUpdatePatch(row, stranger, update)).toBeNull();
    expect(
      onchainTransferUpdatePatch(
        { ...row, role: "operator" },
        operator,
        update,
      ),
    ).toBeNull();
  });
});

const configEvent = (
  author: Pubkey,
  config: OnchainConfig,
  createdAtSec: number,
): AppDataEvent => {
  const eventId = EventId.make(createdAtSec.toString(16).padStart(64, "0"));
  const createdAt = UnixSeconds.make(createdAtSec);
  const { content } = onchainConfigDraft(config);
  const tags = [["d", ONCHAIN_CONFIG_IDENTIFIER]];
  return new AppDataEvent({
    eventId,
    author,
    identifier: ONCHAIN_CONFIG_IDENTIFIER,
    tags,
    content,
    createdAt,
    event: new SignedPlainEvent({
      id: eventId,
      pubkey: author,
      created_at: createdAt,
      kind: 30078,
      tags,
      content,
      sig: "cd".repeat(64),
    }),
  });
};

describe("newestOnchainConfig", () => {
  it("reads the operator's newest config and ignores anyone else's", () => {
    const paused = onchainConfigFixture({ paused: true });
    const stranger = makeIdentity().pubkey;
    expect(
      newestOnchainConfig(
        [
          configEvent(operator, config, 1),
          configEvent(stranger, onchainConfigFixture({ feeBasisPoints: 0 }), 3),
          configEvent(operator, paused, 2),
        ],
        operator,
      ),
    ).toEqual(paused);
    expect(
      newestOnchainConfig([configEvent(stranger, config, 1)], operator),
    ).toBeNull();
  });
});

describe("onchainSendPaymentRequest", () => {
  it("asks for the amount plus the fee at the config's mint, to the operator, under the transfer id", () => {
    const transfer = onchainTransferViewFixture();
    const decoded = decodePaymentRequest(
      onchainSendPaymentRequest(transfer, config.mintUrl, operator),
    );
    expect(decoded).toMatchObject({
      amount: 101_000,
      unit: "sat",
      mints: [config.mintUrl],
      id: transfer.id,
    });
    expect(decoded?.transports).toEqual([
      expect.objectContaining({
        type: "nostr",
        target: nip19.nprofileEncode({ pubkey: operator, relays: [] }),
      }),
    ]);
  });
});
