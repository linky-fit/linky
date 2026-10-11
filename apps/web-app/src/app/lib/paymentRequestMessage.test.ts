import { describe, expect, it } from "vitest";
import { encode } from "cbor-x";
import { nip19 } from "nostr-tools";
import {
  buildCashuPaymentRequestMessage,
  buildLinkyPaymentRequestDeclineMessage,
  parseCashuPaymentRequestMessage,
  parseLinkyPaymentRequestDeclineMessage,
} from "./paymentRequestMessage";
import { encodeBase64Url } from "../../utils/base64";

describe("paymentRequestMessage", () => {
  it("round-trips a cashu payment request message", () => {
    // parseCashuPaymentRequestMessage validates the pubkey is on-curve, so the
    // fixture must be a real one (getPublicKey of the all-ones secret key).
    const recipientPubkey =
      "1b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f";
    const recipientNprofile = nip19.nprofileEncode({
      pubkey: recipientPubkey,
      relays: ["wss://relay.damus.io"],
    });

    const message = buildCashuPaymentRequestMessage({
      amount: 21000,
      description: "Payment request from Linky chat.",
      mintUrls: ["https://mint.example"],
      recipientNprofile,
      requestId: "request-1",
    });

    const parsed = parseCashuPaymentRequestMessage(message);

    expect(parsed).not.toBeNull();
    expect(parsed?.amount).toBe(21000);
    expect(parsed?.description).toBe("Payment request from Linky chat.");
    expect(parsed?.mintUrls).toEqual(["https://mint.example"]);
    expect(parsed?.requestId).toBe("request-1");
    expect(parsed?.transportNprofile).toBe(recipientNprofile);
    expect(parsed?.transportPubkeyHex).toBe(recipientPubkey);
    expect(parsed?.unit).toBe("sat");
  });

  it("parses a cashu payment request with HTTP POST transport", () => {
    const message = `creqA${encodeBase64Url(
      encode({
        a: 21,
        u: "sat",
        m: ["https://mint.example"],
        t: [
          {
            t: "post",
            a: "https://pay.example/request-1",
          },
        ],
      }),
    )}`;

    const parsed = parseCashuPaymentRequestMessage(message);

    expect(parsed?.amount).toBe(21);
    expect(parsed?.transportNprofile).toBeNull();
    expect(parsed?.transportPostUrl).toBe("https://pay.example/request-1");
    expect(parsed?.transportPubkeyHex).toBeNull();
  });

  it("parses a payment request decline marker", () => {
    const message = buildLinkyPaymentRequestDeclineMessage("rumor-123");

    expect(parseLinkyPaymentRequestDeclineMessage(message)).toEqual({
      requestRumorId: "rumor-123",
    });
  });
});
