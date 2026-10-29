import { base64urlnopad } from "@scure/base";
import { encode } from "cbor-x";
import {
  decodePaymentRequest,
  decodePaymentRequestPayload,
  encodeNostrPaymentRequest,
  encodePaymentRequestPayload,
  PaymentRequestId,
} from "./nut18";

const nprofile = "nprofile1qqsyhxk6eexample";

describe("encodeNostrPaymentRequest", () => {
  it("encodes a single-use sat request with a NIP-17 nostr transport in a fixed field order", () => {
    const encoded = encodeNostrPaymentRequest({
      amount: 21,
      mintUrls: [" https://mint.example ", "", "https://mint.example"],
      recipientNprofile: nprofile,
      requestId: PaymentRequestId.make("pay-1"),
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

  it("leaves out an empty description", () => {
    const decoded = decodePaymentRequest(
      encodeNostrPaymentRequest({
        amount: 5,
        mintUrls: ["https://mint.example"],
        recipientNprofile: nprofile,
        requestId: PaymentRequestId.make("pay-1"),
        description: " ",
      }),
    );
    expect(decoded).toMatchObject({ id: "pay-1", description: null });
  });

  it("leaves the amount out when the payer picks it", () => {
    const decoded = decodePaymentRequest(
      encodeNostrPaymentRequest({
        amount: null,
        mintUrls: ["https://mint.example"],
        recipientNprofile: nprofile,
        requestId: PaymentRequestId.make("pay-2"),
      }),
    );
    expect(decoded).toMatchObject({ id: "pay-2", amount: null });
  });
});

describe("decodePaymentRequest", () => {
  it("round-trips what encodeNostrPaymentRequest builds", () => {
    const encoded = encodeNostrPaymentRequest({
      amount: 1000,
      mintUrls: ["https://mint.example"],
      recipientNprofile: nprofile,
      requestId: PaymentRequestId.make("pay-2"),
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
      lock: null,
      mintsAdvisory: false,
      methods: [],
    });
  });

  it("reads an advisory mint list and the payee's melt methods with their fees", () => {
    const encoded = `creqA${base64urlnopad.encode(
      encode({
        a: 10,
        u: "sat",
        m: ["https://mint.example"],
        mp: true,
        sm: [{ mn: "BOLT11", mf: 2 }, { mn: "onchain" }],
      }),
    )}`;
    expect(decodePaymentRequest(encoded)).toMatchObject({
      mintsAdvisory: true,
      methods: [
        { method: "bolt11", fee: 2 },
        { method: "onchain", fee: 0 },
      ],
    });
  });

  it("ignores mp without a mint list", () => {
    const encoded = `creqA${base64urlnopad.encode(encode({ a: 10, u: "sat", mp: true }))}`;
    expect(decodePaymentRequest(encoded)?.mintsAdvisory).toBe(false);
  });

  it("reads an amountless request without an id, and its NUT-10 lock", () => {
    const pubkey = `02${"ab".repeat(32)}`;
    const encoded = `creqA${base64urlnopad.encode(
      encode({
        u: "sat",
        m: ["https://mint.example"],
        nut10: { k: "P2PK", d: pubkey, t: [["locktime", "1"]] },
      }),
    )}`;
    expect(decodePaymentRequest(encoded)).toMatchObject({
      amount: null,
      id: null,
      transports: [],
      lock: { kind: "P2PK", data: pubkey, tags: [["locktime", "1"]] },
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

describe("encodePaymentRequestPayload", () => {
  const proofs = [
    { id: "009a1f293253e41e", amount: 4, secret: "s1", C: "02ab" },
  ];

  it("writes the NUT-18 payload JSON that decodePaymentRequestPayload reads back", () => {
    const text = encodePaymentRequestPayload({
      id: PaymentRequestId.make("pay-1"),
      memo: " Coffee ",
      mint: "https://mint.example",
      unit: "sat",
      proofs,
    });
    expect(JSON.parse(text)).toEqual({
      id: "pay-1",
      memo: "Coffee",
      mint: "https://mint.example",
      unit: "sat",
      proofs,
    });
    expect(decodePaymentRequestPayload(text)?.requestId).toBe("pay-1");
  });

  it("leaves out an empty id and memo", () => {
    const text = encodePaymentRequestPayload({
      id: null,
      memo: "",
      mint: "https://mint.example",
      unit: "sat",
      proofs,
    });
    expect(JSON.parse(text)).toEqual({
      mint: "https://mint.example",
      unit: "sat",
      proofs,
    });
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
