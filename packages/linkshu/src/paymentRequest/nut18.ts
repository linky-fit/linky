import { base64urlnopad } from "@scure/base";
import { decode, encode } from "cbor-x";
import { Option, Schema } from "effect";

const PAYMENT_REQUEST_PREFIX = "creqA";

const Transport = Schema.Struct({
  t: Schema.String,
  a: Schema.String,
  g: Schema.optional(Schema.Array(Schema.Array(Schema.String))),
});

const Payload = Schema.Struct({
  a: Schema.optional(Schema.Number),
  d: Schema.optional(Schema.String),
  i: Schema.optional(Schema.String),
  m: Schema.optional(Schema.Array(Schema.String)),
  s: Schema.optional(Schema.Boolean),
  t: Schema.optional(Schema.Array(Transport)),
  u: Schema.optional(Schema.String),
});
type Payload = typeof Payload.Type;

const isPayload = Schema.is(Payload);

const trimmedOrNull = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
};

// Re-wrapped so a realm-foreign view (a Node Buffer under jsdom) passes
// @scure/base's instanceof check.
const encodeBase64Url = (bytes: Uint8Array): string =>
  base64urlnopad.encode(
    new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
  );

/** Tolerates padding and the standard alphabet; null when not base64. */
const decodeBase64Url = (value: string): Uint8Array | null => {
  try {
    return base64urlnopad.decode(
      value.trim().replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
    );
  } catch {
    return null;
  }
};

export interface NostrPaymentRequestArgs {
  /** Sats requested. */
  readonly amount: number;
  readonly mintUrls: ReadonlyArray<string>;
  /** Where the payer sends the token, as a NIP-17 message. */
  readonly recipientNprofile: string;
  readonly requestId?: string | null | undefined;
  readonly description?: string | null | undefined;
}

/**
 * A NUT-18 `creqA…` payment request for `amount` sat, single use, payable
 * at `mintUrls`, delivered over a nostr transport to `recipientNprofile` as
 * a NIP-17 message (`["n", "17"]`). Field order is part of the encoding:
 * the same arguments always produce the same text.
 */
export const encodeNostrPaymentRequest = (
  args: NostrPaymentRequestArgs,
): string => {
  const requestId = trimmedOrNull(args.requestId);
  const description = trimmedOrNull(args.description);
  const payload: Payload = {
    a: args.amount,
    u: "sat",
    s: true,
    m: args.mintUrls.flatMap((mint) => trimmedOrNull(mint) ?? []),
    t: [{ t: "nostr", a: args.recipientNprofile, g: [["n", "17"]] }],
    ...(requestId === null ? {} : { i: requestId }),
    ...(description === null ? {} : { d: description }),
  };
  return `${PAYMENT_REQUEST_PREFIX}${encodeBase64Url(encode(payload))}`;
};

export interface PaymentRequestTransport {
  /** `nostr` or `post` in NUT-18; trimmed, as sent. */
  readonly type: string;
  /** An nprofile for `nostr`, a URL for `post`; trimmed. */
  readonly target: string;
  readonly tags: ReadonlyArray<ReadonlyArray<string>>;
}

export interface DecodedPaymentRequest {
  /** The trimmed `creqA…` text. */
  readonly encoded: string;
  readonly amount: number | null;
  /** Lowercased. */
  readonly unit: string | null;
  readonly singleUse: boolean | null;
  readonly mints: ReadonlyArray<string>;
  readonly description: string | null;
  readonly id: string | null;
  readonly transports: ReadonlyArray<PaymentRequestTransport>;
}

/** A `creqA…` NUT-18 request; null for anything else. Nothing is validated beyond its shape. */
export const decodePaymentRequest = (
  value: string,
): DecodedPaymentRequest | null => {
  const encoded = value.trim();
  if (!encoded.startsWith(PAYMENT_REQUEST_PREFIX)) return null;
  const bytes = decodeBase64Url(encoded.slice(PAYMENT_REQUEST_PREFIX.length));
  if (bytes === null) return null;
  let decoded: unknown;
  try {
    decoded = decode(bytes);
  } catch {
    return null;
  }
  if (!isPayload(decoded)) return null;
  return {
    encoded,
    amount: decoded.a ?? null,
    unit: trimmedOrNull(decoded.u)?.toLowerCase() ?? null,
    singleUse: decoded.s ?? null,
    mints: (decoded.m ?? []).flatMap((mint) => trimmedOrNull(mint) ?? []),
    description: trimmedOrNull(decoded.d),
    id: trimmedOrNull(decoded.i),
    transports: (decoded.t ?? []).map((transport) => ({
      type: transport.t.trim(),
      target: transport.a.trim(),
      tags: transport.g ?? [],
    })),
  };
};

const PaymentPayload = Schema.fromJsonString(
  Schema.Struct({
    id: Schema.optional(Schema.String),
    memo: Schema.optional(Schema.String),
    mint: Schema.String,
    unit: Schema.String,
    proofs: Schema.NonEmptyArray(
      Schema.Struct({ amount: Schema.Number, secret: Schema.String }),
    ),
  }),
);
const decodePaymentPayload = Schema.decodeUnknownOption(PaymentPayload);

export interface PaymentRequestPayloadSummary {
  /** The `id` of the request it pays, when the payer echoed it. */
  readonly requestId: string | null;
  readonly mint: string;
  readonly unit: string;
  readonly memo: string | null;
  /** Face value of the proofs, before the mint's input fee. */
  readonly amount: number;
}

/**
 * The NUT-18 payment payload a payer sends over a transport
 * (`{id, memo, mint, unit, proofs}` JSON), for matching it to the request.
 * Receive the text itself with `Receive.receive`, which accepts the same
 * JSON. Null for anything else, a bare `cashuA`/`cashuB` token included.
 */
export const decodePaymentRequestPayload = (
  text: string,
): PaymentRequestPayloadSummary | null =>
  Option.match(decodePaymentPayload(text.trim()), {
    onNone: () => null,
    onSome: (payload) => ({
      requestId: trimmedOrNull(payload.id),
      mint: payload.mint.trim(),
      unit: payload.unit.trim().toLowerCase(),
      memo: trimmedOrNull(payload.memo),
      amount: payload.proofs.reduce((sum, proof) => sum + proof.amount, 0),
    }),
  });
