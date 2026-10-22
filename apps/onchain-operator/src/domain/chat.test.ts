import { createId } from "@linky-fit/domain";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { describe, expect, it } from "vitest";
import { nut18Payload, testMint, tokenOf } from "../services/testing/fakes";
import {
  chatTimeline,
  lastActivitySec,
  messageContent,
  type ChatMessage,
} from "./chat";
import type { OperatorTransfer } from "./transfer";

const user = makeIdentity().pubkey;

const transferAt = (createdAtSec: number): OperatorTransfer => ({
  id: createId<"OnchainTransfer">(),
  createdAtSec,
  user,
  direction: "send",
  amount: 100_000,
  feeBasisPoints: 100,
  payoutAddress: "bcrt1qaddress",
  refund: null,
  userPaymentRequest: null,
  operatorPaymentRequest: null,
  depositAddress: null,
  addressIndex: null,
  update: null,
  userCancelledAtSec: null,
});

const messageAt = (createdAtSec: number): ChatMessage => ({
  id: `m-${createdAtSec}`,
  direction: "in",
  text: "hi",
  createdAtSec,
  status: "sent",
});

describe("messageContent", () => {
  it("tells ecash from text and keeps the mint, unit and request id", () => {
    expect(messageContent("hello")).toEqual({ _tag: "text", text: "hello" });
    expect(messageContent(nut18Payload("transfer-1", 500))).toEqual({
      _tag: "ecash",
      amount: 500,
      mint: testMint,
      unit: "sat",
      requestId: "transfer-1",
    });
    expect(messageContent(tokenOf(64))).toEqual({
      _tag: "ecash",
      amount: 64,
      mint: testMint,
      unit: "sat",
      requestId: null,
    });
  });
});

describe("chatTimeline", () => {
  it("puts each transfer where it was requested among the messages", () => {
    const early = transferAt(15);
    const late = transferAt(40);
    expect(
      chatTimeline(
        [messageAt(10), messageAt(20), messageAt(30)],
        [late, early],
      ).map((item) =>
        item._tag === "transfer" ? item.transfer.createdAtSec : item.message.id,
      ),
    ).toEqual(["m-10", 15, "m-20", "m-30", 40]);
  });

  it("dates a chat by its newest message or transfer", () => {
    const chat = { peer: user, messages: [messageAt(10)], unread: false };
    expect(lastActivitySec(chat, [transferAt(50)])).toBe(50);
    expect(lastActivitySec(chat, [])).toBe(10);
  });
});
