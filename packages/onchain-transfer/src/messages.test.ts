import {
  AppMessageReceived,
  ClientId,
  RumorId,
  UnixSeconds,
} from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { createId } from "@linky-fit/domain";
import { Option } from "effect";
import {
  decodeTransferUpdateColumn,
  encodeTransferUpdateColumn,
  newerTransferUpdate,
  onchainTransferChannel,
  type OnchainTransferMessage,
  type OnchainTransferUpdate,
} from "./messages";

const transferId = createId<"OnchainTransfer">();
const txid = "a".repeat(64);
const user = makeIdentity();
const operator = makeIdentity();

const sendRequest: OnchainTransferMessage = {
  v: 1,
  type: "request",
  transferId,
  direction: "send",
  amount: 100_000,
  feeBasisPoints: 100,
  payoutAddress: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
};

const receiveRequest: OnchainTransferMessage = {
  v: 1,
  type: "request",
  transferId,
  direction: "receive",
  amount: 250_000,
  feeBasisPoints: 100,
  refund: { to: "sender" },
  paymentRequest: "creqA1234",
};

const update = (
  overrides: Partial<OnchainTransferUpdate> = {},
): OnchainTransferUpdate => ({
  v: 1,
  type: "update",
  transferId,
  revision: 1,
  status: "accepted",
  fee: 1_000,
  sendAmount: 101_000,
  ...overrides,
});

const received = (content: string) =>
  new AppMessageReceived({
    messageId: RumorId.make("ab".repeat(32)),
    from: user.pubkey,
    app: onchainTransferChannel.app,
    content,
    clientId: null,
    sentAt: UnixSeconds.make(1_700_000_000),
  });

const roundTrip = (message: OnchainTransferMessage) =>
  onchainTransferChannel.decode(
    received(onchainTransferChannel.draft(operator.pubkey, message).content),
  );

describe("transfer messages", () => {
  it.each<[string, OnchainTransferMessage]>([
    ["a send request", sendRequest],
    ["a receive request", receiveRequest],
    [
      "a request refunding to an address",
      { ...receiveRequest, refund: { to: "address", address: "bc1qtest" } },
    ],
    ["a cancel", { v: 1, type: "cancel", transferId }],
    [
      "a full update",
      update({
        status: "fundsSeen",
        depositAddress: "bc1ptest",
        paymentRequest: "creqA5678",
        txid,
        confirmations: 1,
        receivedAmount: 100_000,
        refundTxid: txid,
        reason: "Paid late",
      }),
    ],
  ])("round-trips %s", (_, message) => {
    expect(roundTrip(message)).toEqual(Option.some(message));
  });

  it("drafts to the recipient on the transfer namespace", () => {
    const draft = onchainTransferChannel.draft(operator.pubkey, sendRequest, {
      clientId: ClientId.make("client-1"),
    });
    expect(draft).toMatchObject({
      to: operator.pubkey,
      app: "linky.onchain-transfer",
      clientId: "client-1",
    });
  });

  const valid = JSON.stringify(sendRequest);
  it.each([
    ["not JSON", "{"],
    ["an unknown type", JSON.stringify({ ...sendRequest, type: "hello" })],
    ["another version", JSON.stringify({ ...sendRequest, v: 2 })],
    [
      "a transfer id that is not an id",
      JSON.stringify({ ...sendRequest, transferId: "x" }),
    ],
    ["a zero amount", JSON.stringify({ ...sendRequest, amount: 0 })],
    ["a fractional amount", JSON.stringify({ ...sendRequest, amount: 1.5 })],
    [
      "fee basis points above 10000",
      JSON.stringify({ ...sendRequest, feeBasisPoints: 10_001 }),
    ],
    [
      "an unknown direction",
      JSON.stringify({ ...sendRequest, direction: "sideways" }),
    ],
    [
      "a send request without a payout address",
      JSON.stringify({ ...sendRequest, payoutAddress: undefined }),
    ],
    [
      "a receive request without a refund",
      JSON.stringify({ ...receiveRequest, refund: undefined }),
    ],
    [
      "a receive request without a payment request",
      JSON.stringify({ ...receiveRequest, paymentRequest: undefined }),
    ],
    [
      "a refund to no address",
      JSON.stringify({ ...receiveRequest, refund: { to: "address" } }),
    ],
    ["an update at revision 0", JSON.stringify(update({ revision: 0 }))],
    [
      "an update with an unknown status",
      JSON.stringify({ ...update(), status: "lost" }),
    ],
    [
      "an update with a malformed txid",
      JSON.stringify(update({ txid: "xyz" })),
    ],
    [
      "an update with a long reason",
      JSON.stringify(update({ reason: "x".repeat(501) })),
    ],
  ])("rejects %s", (_, content) => {
    expect(content).not.toBe(valid);
    expect(onchainTransferChannel.decode(received(content))).toEqual(
      Option.none(),
    );
  });

  it("ignores fields a newer release added", () => {
    const content = JSON.stringify({ ...update(), futureField: 1 });
    expect(onchainTransferChannel.decode(received(content))).toEqual(
      Option.some(update()),
    );
  });
});

describe("newerTransferUpdate", () => {
  it("takes the first update and every higher revision", () => {
    const first = update();
    const second = update({ revision: 2, status: "fundsReceived" });
    expect(newerTransferUpdate(null, first)).toBe(first);
    expect(newerTransferUpdate(first, second)).toBe(second);
  });

  it("keeps the current update for a replay or an older revision", () => {
    const current = update({ revision: 2, status: "fundsReceived" });
    expect(newerTransferUpdate(current, update({ revision: 2 }))).toBe(current);
    expect(newerTransferUpdate(current, update({ revision: 1 }))).toBe(current);
  });
});

describe("update column", () => {
  it("round-trips the update without its payment request", () => {
    const column = encodeTransferUpdateColumn(
      update({ paymentRequest: "creqA5678", txid }),
    );
    expect(column).not.toContain("creqA5678");
    expect(decodeTransferUpdateColumn(column)).toEqual(update({ txid }));
  });

  it("reads an empty or unreadable column as no update", () => {
    expect(decodeTransferUpdateColumn(null)).toBeNull();
    expect(decodeTransferUpdateColumn("{")).toBeNull();
    expect(decodeTransferUpdateColumn('{"v":1}')).toBeNull();
  });

  const fullest = update({
    status: "refunded",
    depositAddress: "b".repeat(100),
    txid,
    confirmations: 1_000_000,
    receivedAmount: 2_100_000_000_000_000,
    refundTxid: txid,
  });

  it("fits a full update with the longest reason in 1000 characters", () => {
    const column = encodeTransferUpdateColumn({
      ...fullest,
      reason: "r".repeat(500),
    });
    expect(column.length).toBeLessThanOrEqual(1000);
    expect(decodeTransferUpdateColumn(column)?.reason).toBe("r".repeat(500));
  });

  it("shortens a reason whose JSON escapes would overflow the column", () => {
    const column = encodeTransferUpdateColumn({
      ...fullest,
      reason: '"'.repeat(500),
    });
    expect(column.length).toBeLessThanOrEqual(1000);
    const decoded = decodeTransferUpdateColumn(column);
    expect(decoded).toMatchObject({
      ...fullest,
      reason: expect.stringMatching(/^"+$/),
    });
  });
});
