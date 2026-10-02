import { boltCardId, createBoltCard } from "./card";
import {
  decodeBridgeMessage,
  decodeCardMessage,
  encodeBridgeMessage,
  encodeCardMessage,
  signBridgeChallenge,
  verifyBridgeChallenge,
} from "./protocol";

const challenge = "ab".repeat(32);

describe("bridge protocol", () => {
  test("a card proves its id by signing the challenge", () => {
    const card = createBoltCard();
    const signature = signBridgeChallenge(card.secretKey, challenge);
    expect(verifyBridgeChallenge(boltCardId(card), challenge, signature)).toBe(
      true,
    );
    expect(
      verifyBridgeChallenge(boltCardId(createBoltCard()), challenge, signature),
    ).toBe(false);
    expect(
      verifyBridgeChallenge(boltCardId(card), "cd".repeat(32), signature),
    ).toBe(false);
    expect(verifyBridgeChallenge(boltCardId(card), challenge, "00")).toBe(
      false,
    );
  });

  test("messages round-trip and reject unknown shapes", () => {
    const withdraw = {
      _tag: "withdraw",
      id: "1",
      p: "00".repeat(16),
      c: "00".repeat(8),
    } as const;
    expect(decodeBridgeMessage(encodeBridgeMessage(withdraw))).toEqual(
      withdraw,
    );
    const offer = {
      _tag: "offer",
      id: "1",
      k1: "11".repeat(32),
      minWithdrawable: 1_000,
      maxWithdrawable: 21_000,
      defaultDescription: "Linky",
    } as const;
    expect(decodeCardMessage(encodeCardMessage(offer))).toEqual(offer);

    expect(decodeBridgeMessage('{"_tag":"withdraw","id":"1"}')).toBeNull();
    expect(decodeCardMessage("not json")).toBeNull();
    expect(
      decodeCardMessage(JSON.stringify({ ...offer, maxWithdrawable: 0 })),
    ).toBeNull();
  });
});
