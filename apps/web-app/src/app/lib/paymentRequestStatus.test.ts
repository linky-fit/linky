import {
  encodePaymentRequestPayload,
  PaymentRequestId,
} from "@linky-fit/linkshu/payment-request";
import { encode } from "cbor-x";
import { nip19 } from "nostr-tools";
import { describe, expect, it } from "vitest";
import type { LocalNostrMessage } from "../types/appTypes";
import { encodeBase64Url } from "../../utils/base64";
import {
  buildCashuPaymentRequestMessage,
  buildLinkyPaymentRequestDeclineMessage,
} from "./paymentRequestMessage";
import {
  paymentRequestAnswersByRumorId,
  requestIdFulfilledBy,
} from "./paymentRequestStatus";

const REQUEST_ID = PaymentRequestId.make("request-1");
// getPublicKey of the all-ones secret key; the parser checks it is on-curve.
const NPROFILE = nip19.nprofileEncode({
  pubkey: "1b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f",
  relays: [],
});

const request = (requestId: PaymentRequestId | null): string =>
  requestId === null
    ? `creqA${encodeBase64Url(encode({ a: 21, u: "sat", m: [] }))}`
    : buildCashuPaymentRequestMessage({
        amount: 21,
        mintUrls: [],
        recipientNprofile: NPROFILE,
        requestId,
      });

const payload = (requestId: PaymentRequestId | null): string =>
  encodePaymentRequestPayload({
    id: requestId,
    mint: "https://mint.example",
    unit: "sat",
    proofs: [{ id: "009a1f293253e41e", amount: 21, secret: "s", C: "02ab" }],
  });

const bareToken = `cashuA${encodeBase64Url(
  new TextEncoder().encode(
    JSON.stringify({
      token: [
        {
          mint: "https://mint.example",
          proofs: [
            { id: "009a1f293253e41e", amount: 21, secret: "s", C: "02ab" },
          ],
        },
      ],
      unit: "sat",
    }),
  ),
)}`;

type Row = Pick<
  LocalNostrMessage,
  "content" | "createdAtSec" | "direction" | "replyToId" | "rumorId"
>;

const row = (
  rumorId: string,
  direction: Row["direction"],
  content: string,
  createdAtSec: number,
  replyToId: string | null = null,
): Row => ({ content, createdAtSec, direction, replyToId, rumorId });

const statusOf = (rows: Row[]) =>
  paymentRequestAnswersByRumorId(rows).get("req") ?? "requested";

describe("paymentRequestAnswersByRumorId", () => {
  it.each([
    ["a request I sent, paid by the peer", "out", "in", "paid"],
    ["a request I sent, paid by my own payload", "out", "out", "requested"],
    ["a request I received, paid by me", "in", "out", "paid"],
    ["a request I received, paid by the requester", "in", "in", "requested"],
  ] as const)(
    "marks %s as %s",
    (_, requestDirection, paymentDirection, status) => {
      expect(
        statusOf([
          row("req", requestDirection, request(REQUEST_ID), 1),
          row("pay", paymentDirection, payload(REQUEST_ID), 2),
        ]),
      ).toBe(status);
    },
  );

  it("ignores an incoming payload naming another request id, even as a reply", () => {
    expect(
      statusOf([
        row("req", "out", request(REQUEST_ID), 1),
        row("pay", "in", payload(PaymentRequestId.make("other")), 2, "req"),
      ]),
    ).toBe("requested");
  });

  it("ignores an incoming bare token replying to the request", () => {
    expect(
      statusOf([
        row("req", "out", request(REQUEST_ID), 1),
        row("pay", "in", bareToken, 2, "req"),
      ]),
    ).toBe("requested");
  });

  it("counts my own bare token replying to a request I received, as an older Linky paid it", () => {
    expect(
      statusOf([
        row("req", "in", request(REQUEST_ID), 1),
        row("pay", "out", bareToken, 2, "req"),
      ]),
    ).toBe("paid");
  });

  describe("a request without a request id", () => {
    it("is paid by my payload replying to it", () => {
      expect(
        statusOf([
          row("req", "in", request(null), 1),
          row("pay", "out", payload(null), 2, "req"),
        ]),
      ).toBe("paid");
    });

    it.each([
      ["my payload that replies to nothing", "in", "out", null],
      ["an incoming payload replying to my request", "out", "in", "req"],
    ] as const)(
      "is not paid by %s",
      (_, requestDirection, paymentDirection, replyToId) => {
        expect(
          statusOf([
            row("req", requestDirection, request(null), 1),
            row("pay", paymentDirection, payload(null), 2, replyToId),
          ]),
        ).toBe("requested");
      },
    );
  });

  it("keeps the latest answer of a decline and a payment", () => {
    const req = row("req", "in", request(REQUEST_ID), 1);
    const decline = (atSec: number) =>
      row(
        "dec",
        "out",
        buildLinkyPaymentRequestDeclineMessage("req"),
        atSec,
        "req",
      );
    const payment = (atSec: number) =>
      row("pay", "out", payload(REQUEST_ID), atSec);

    expect(statusOf([req, decline(2)])).toBe("declined");
    expect(statusOf([req, decline(2), payment(3)])).toBe("paid");
    expect(statusOf([req, payment(2), decline(3)])).toBe("declined");
  });
});

describe("requestIdFulfilledBy", () => {
  const incoming = { content: payload(REQUEST_ID), direction: "in" as const };

  it("links an incoming payload to the request I sent with its id", () => {
    expect(
      requestIdFulfilledBy(incoming, [
        { content: request(REQUEST_ID), direction: "out" },
      ]),
    ).toBe(REQUEST_ID);
  });

  it.each([
    ["the request with its id came from the peer", incoming, "in"],
    [
      "the payment is my own",
      { ...incoming, direction: "out" as const },
      "out",
    ],
    [
      "the payload names no request",
      { ...incoming, content: payload(null) },
      "out",
    ],
    ["it is a bare token", { ...incoming, content: "cashuBfaketoken" }, "out"],
  ] as const)("links nothing when %s", (_, payment, requestDirection) => {
    expect(
      requestIdFulfilledBy(payment, [
        { content: request(REQUEST_ID), direction: requestDirection },
      ]),
    ).toBeNull();
  });

  it("links nothing when the conversation holds no request with its id", () => {
    expect(
      requestIdFulfilledBy(incoming, [
        { content: request(PaymentRequestId.make("other")), direction: "out" },
      ]),
    ).toBeNull();
  });
});
