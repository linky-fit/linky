import { createId } from "@linky-fit/domain";
import {
  encodeNostrPaymentRequest,
  PaymentRequestId,
} from "@linky-fit/linkshu";
import { encodeNprofile, encodeNpub } from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { describe, expect, it } from "vitest";
import type { OperatorTransfer } from "./transfer";
import { MAX_WATCHERS, parseWatchers, watcherAlertText } from "./watchers";

const user = makeIdentity().pubkey;

const transfer: OperatorTransfer = {
  id: createId<"OnchainTransfer">(),
  createdAtSec: 1_700_000_000,
  user,
  direction: "send",
  amount: 100_000,
  feeBasisPoints: 100,
  payoutAddress: "bcrt1q6rz28mcfaxtmd6v789l9rrlrusdprr9pz3cppk",
  refund: null,
  userPaymentRequest: null,
  operatorPaymentRequest: null,
  depositAddress: null,
  addressIndex: null,
  ecashSendId: null,
  update: null,
  userCancelledAtSec: null,
};

describe("parseWatchers", () => {
  it("reads npubs separated by lines, commas or spaces, without repeats", () => {
    const [a, b] = [makeIdentity().pubkey, makeIdentity().pubkey];
    expect(
      parseWatchers(`${encodeNpub(a)}\n ${encodeNpub(b)}, ${encodeNpub(a)}`),
    ).toEqual([a, b]);
    expect(parseWatchers("  ")).toEqual([]);
  });

  it("rejects anything that is no npub, and too many", () => {
    expect(parseWatchers("npub1nope")).toBeNull();
    expect(parseWatchers(user)).toBeNull();
    expect(
      parseWatchers(
        Array.from({ length: MAX_WATCHERS + 1 }, () =>
          encodeNpub(makeIdentity().pubkey),
        ).join("\n"),
      ),
    ).toBeNull();
  });
});

describe("watcherAlertText", () => {
  it("says what waits for the operator, after the user's whole npub", () => {
    const npub = encodeNpub(user);
    expect(watcherAlertText({ _tag: "requested", transfer }, npub)).toBe(
      `${npub} wants to send 100 000 sat onchain`,
    );
    expect(watcherAlertText({ _tag: "payoutDue", transfer }, npub)).toBe(
      `${npub} paid to send 100 000 sat onchain. Pay their address.`,
    );
    const receive: OperatorTransfer = { ...transfer, direction: "receive" };
    expect(
      watcherAlertText(
        { _tag: "ecashDue", transfer: receive, receivedAmount: 101_000 },
        npub,
      ),
    ).toBe(
      `${npub} deposited to receive 100 000 sat onchain. Send them the Cashu.`,
    );
    expect(
      watcherAlertText(
        { _tag: "ecashDue", transfer: receive, receivedAmount: 100_000 },
        npub,
      ),
    ).toBe(
      `${npub} deposited 100 000 sat to receive 100 000 sat onchain, less than the 101 000 sat due. Settle it in the chat.`,
    );
    expect(
      watcherAlertText({ _tag: "cancelledAfterFunds", transfer }, npub),
    ).toBe(
      `${npub} no longer wants to send 100 000 sat onchain, but the funds moved. Settle it in the chat.`,
    );
  });

  it("names no amount for a receive of any amount without its deposit", () => {
    const anyAmount: OperatorTransfer = {
      ...transfer,
      direction: "receive",
      userPaymentRequest: encodeNostrPaymentRequest({
        amount: null,
        mintUrls: ["https://mint.example"],
        recipientNprofile: encodeNprofile(user, []),
        requestId: PaymentRequestId.make(transfer.id),
      }),
    };
    expect(
      watcherAlertText({ _tag: "requested", transfer: anyAmount }, "npub1x"),
    ).toBe("npub1x wants to receive onchain");
  });

  it("quotes a long message in part", () => {
    const text = watcherAlertText(
      { _tag: "message", from: user, text: ` ${"a".repeat(300)} ` },
      "Alice",
    );
    expect(text).toBe(`Alice wrote: "${"a".repeat(200)}…"`);
  });
});
