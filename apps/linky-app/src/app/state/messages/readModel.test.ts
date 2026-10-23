import {
  encodePaymentRequestPayload,
  PaymentRequestId,
} from "@linky-fit/linkshu/payment-request";
import { encodeNpub } from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { describe, expect, it } from "vitest";
import { buildUnknownContactId } from "../../hooks/messages/contactIdentity";
import { isShownInChat, onchainOperatorChatIds } from "./readModel";

const operatorPubkey = makeIdentity().pubkey;
const operator = { npub: encodeNpub(operatorPubkey), pubkey: operatorPubkey };

const payment = encodePaymentRequestPayload({
  id: PaymentRequestId.make("transfer-1"),
  mint: "https://mint.example",
  unit: "sat",
  proofs: [{ id: "009a1f293253e41e", amount: 21, secret: "s", C: "02ab" }],
});

describe("onchainOperatorChatIds", () => {
  it("names the operator's saved contacts and its unknown-sender chat, none without an operator", () => {
    const contacts = [
      { id: "support", npub: operator.npub },
      { id: "friend", npub: encodeNpub(makeIdentity().pubkey) },
      { id: "no-npub", npub: null },
    ];
    expect([...onchainOperatorChatIds(operator, contacts)]).toEqual([
      "support",
      buildUnknownContactId(operatorPubkey),
    ]);
    expect(onchainOperatorChatIds(null, contacts).size).toBe(0);
  });
});

describe("isShownInChat", () => {
  const shown = isShownInChat(new Set(["support"]));

  it("hides only on-chain transfer payments in the operator's chat", () => {
    expect(shown({ contactId: "support", content: payment })).toBe(false);
    expect(shown({ contactId: "support", content: "Hi, where is it?" })).toBe(
      true,
    );
    expect(shown({ contactId: "friend", content: payment })).toBe(true);
  });
});
