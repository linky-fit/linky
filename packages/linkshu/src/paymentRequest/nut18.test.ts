import { base64urlnopad } from "@scure/base";
import { encode } from "cbor-x";
import {
  decodePaymentRequest,
  decodePaymentRequestPayload,
  encodeNostrPaymentRequest,
} from "./nut18";

const nprofile = "nprofile1qqsyhxk6eexample";

describe("encodeNostrPaymentRequest", () => {
  it("encodes a single-use sat request with a NIP-17 nostr transport in a fixed field order", () => {
    const encoded = encodeNostrPaymentRequest({
      amount: 21,
      mintUrls: [" https://mint.example ", ""],
      recipientNprofile: nprofile,
      requestId: " pay-1 ",
      description: "Coffee",
    });

    const expected = encode({
      a: 21,
      u: "sat",
      s: true,
      m: ["https://mint.example"],
      t: [{ t: "nostr", a: nprofile, g: [["n", "17"]] }],
      i: "pay-1",
      d: "Coffee",
    });
    expect(encoded).toBe(`creqA${base64urlnopad.encode(expected)}`);
  });

  it("leaves out an empty id and description", () => {
    const decoded = decodePaymentRequest(
      encodeNostrPaymentRequest({
        amount: 5,
        mintUrls: ["https://mint.example"],
        recipientNprofile: nprofile,
        requestId: "  ",
        description: null,
      }),
    );
    expect(decoded).toMatchObject({ id: null, description: null });
  });
});

describe("decodePaymentRequest", () => {
  it("round-trips what encodeNostrPaymentRequest builds", () => {
    const encoded = encodeNostrPaymentRequest({
      amount: 1000,
      mintUrls: ["https://mint.example"],
      recipientNprofile: nprofile,
      requestId: "pay-2",
    });
    expect(decodePaymentRequest(` ${encoded} `)).toEqual({
      encoded,
      amount: 1000,
      unit: "sat",
      singleUse: true,
      mints: ["https://mint.example"],
      description: null,
      id: "pay-2",
      transports: [{ type: "nostr", target: nprofile, tags: [["n", "17"]] }],
    });
  });

  it("rejects text that is not a creqA request", () => {
    expect(decodePaymentRequest("cashuBabc")).toBeNull();
    expect(decodePaymentRequest("creqA!!!")).toBeNull();
    expect(
      decodePaymentRequest(`creqA${base64urlnopad.encode(encode({ a: "x" }))}`),
    ).toBeNull();
  });
});

describe("decodePaymentRequestPayload", () => {
  const payload = {
    id: "pay-1",
    memo: "Coffee",
    mint: "https://mint.example",
    unit: "sat",
    proofs: [
      { id: "009a1f293253e41e", amount: 4, secret: "s1", C: "02ab" },
      { id: "009a1f293253e41e", amount: 1, secret: "s2", C: "02ab" },
    ],
  };

  it("summarizes the payment a payer sends for a request", () => {
    expect(decodePaymentRequestPayload(JSON.stringify(payload))).toEqual({
      requestId: "pay-1",
      mint: "https://mint.example",
      unit: "sat",
      memo: "Coffee",
      amount: 5,
    });
  });

  it("rejects token text and payloads without proofs", () => {
    expect(decodePaymentRequestPayload("cashuBabc")).toBeNull();
    expect(
      decodePaymentRequestPayload(JSON.stringify({ ...payload, proofs: [] })),
    ).toBeNull();
  });
});
