import { decodeNprofilePubkey } from "@linky/linkstr";
import { decode, encode } from "cbor-x";
import { Schema } from "effect";
import { decodeBase64Url, encodeBase64Url } from "../../utils/base64";
import { trimString } from "../../utils/validation";

const PaymentRequestTransport = Schema.Struct({
  a: Schema.String,
  g: Schema.optional(Schema.Array(Schema.Array(Schema.String))),
  t: Schema.String,
});

const PaymentRequestPayload = Schema.Struct({
  a: Schema.optional(Schema.Number),
  d: Schema.optional(Schema.String),
  i: Schema.optional(Schema.String),
  m: Schema.optional(Schema.Array(Schema.String)),
  s: Schema.optional(Schema.Boolean),
  t: Schema.optional(Schema.Array(PaymentRequestTransport)),
  u: Schema.optional(Schema.String),
});
type PaymentRequestPayload = typeof PaymentRequestPayload.Type;

const isPaymentRequestPayload = Schema.is(PaymentRequestPayload);

export interface CashuPaymentRequestMessageInfo {
  amount: number;
  description: string | null;
  encodedRequest: string;
  mintUrls: string[];
  requestId: string | null;
  transportNprofile: string | null;
  transportPostUrl: string | null;
  transportPubkeyHex: string | null;
  unit: string;
}

const CASHU_PAYMENT_REQUEST_PREFIX = "creqA";
const LINKY_PAYMENT_REQUEST_DECLINE_PREFIX = "linky:req-decline:v1";

export const buildCashuPaymentRequestMessage = (args: {
  amount: number;
  description?: string | null;
  mintUrls: readonly string[];
  recipientNprofile: string;
  requestId?: string | null;
}): string => {
  const requestId = trimString(args.requestId);
  const description = trimString(args.description);
  const payload: PaymentRequestPayload = {
    a: args.amount,
    u: "sat",
    s: true,
    m: args.mintUrls.map((mintUrl) => trimString(mintUrl)).filter(Boolean),
    t: [
      {
        t: "nostr",
        a: args.recipientNprofile,
        g: [["n", "17"]],
      },
    ],
    ...(requestId ? { i: requestId } : {}),
    ...(description ? { d: description } : {}),
  };

  return `${CASHU_PAYMENT_REQUEST_PREFIX}${encodeBase64Url(encode(payload))}`;
};

export const parseCashuPaymentRequestMessage = (
  value: string,
): CashuPaymentRequestMessageInfo | null => {
  const normalized = trimString(value);
  if (!normalized.startsWith(CASHU_PAYMENT_REQUEST_PREFIX)) return null;

  const bytes = decodeBase64Url(
    normalized.slice(CASHU_PAYMENT_REQUEST_PREFIX.length),
  );
  if (!bytes) return null;

  let decoded: unknown;
  try {
    decoded = decode(bytes);
  } catch {
    return null;
  }

  if (!isPaymentRequestPayload(decoded)) return null;
  if (
    !Number.isFinite(decoded.a) ||
    decoded.a === undefined ||
    decoded.a <= 0
  ) {
    return null;
  }

  const unit = trimString(decoded.u).toLowerCase();
  if (unit !== "sat") return null;

  const transports = Array.isArray(decoded.t) ? decoded.t : [];
  const nostrTransport =
    transports.find((transport) => trimString(transport.t) === "nostr") ?? null;
  const transportTarget = nostrTransport ? trimString(nostrTransport.a) : "";
  const transportNprofile =
    transportTarget && decodeNprofilePubkey(transportTarget)
      ? transportTarget
      : null;
  const transportPubkeyHex = transportNprofile
    ? decodeNprofilePubkey(transportNprofile)
    : null;
  const postTransport =
    transports.find((transport) => trimString(transport.t) === "post") ?? null;
  const transportPostUrl = postTransport ? trimString(postTransport.a) : null;

  return {
    amount: Math.trunc(decoded.a),
    description: trimString(decoded.d) || null,
    encodedRequest: normalized,
    mintUrls: Array.isArray(decoded.m)
      ? decoded.m.map((mintUrl) => trimString(mintUrl)).filter(Boolean)
      : [],
    requestId: trimString(decoded.i) || null,
    transportNprofile,
    transportPostUrl,
    transportPubkeyHex,
    unit,
  };
};

export const buildLinkyPaymentRequestDeclineMessage = (
  requestRumorId: string,
) => `${LINKY_PAYMENT_REQUEST_DECLINE_PREFIX}:${trimString(requestRumorId)}`;

export const parseLinkyPaymentRequestDeclineMessage = (
  value: string,
): { requestRumorId: string | null } | null => {
  const normalized = trimString(value);
  if (!normalized.startsWith(`${LINKY_PAYMENT_REQUEST_DECLINE_PREFIX}:`)) {
    return null;
  }

  const requestRumorId = trimString(
    normalized.slice(LINKY_PAYMENT_REQUEST_DECLINE_PREFIX.length + 1),
  );

  return {
    requestRumorId: requestRumorId || null,
  };
};
