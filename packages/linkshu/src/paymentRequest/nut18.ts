import { base64urlnopad } from "@scure/base";
import { decode, encode } from "cbor-x";
import { Option, Schema } from "effect";

const PAYMENT_REQUEST_PREFIX = "creqA";

const Transport = Schema.Struct({
  t: Schema.String,
  a: Schema.String,
  g: Schema.optional(Schema.Array(Schema.Array(Schema.String))),
});

const Nut10 = Schema.Struct({
  k: Schema.String,
  d: Schema.String,
  t: Schema.optional(Schema.Array(Schema.Array(Schema.String))),
});

const Payload = Schema.Struct({
  a: Schema.optional(Schema.Number),
  d: Schema.optional(Schema.String),
  i: Schema.optional(Schema.String),
  m: Schema.optional(Schema.Array(Schema.String)),
  mp: Schema.optional(Schema.Boolean),
  sm: Schema.optional(
    Schema.Array(
      Schema.Struct({ mn: Schema.String, mf: Schema.optional(Schema.Number) }),
    ),
  ),
  s: Schema.optional(Schema.Boolean),
  t: Schema.optional(Schema.Array(Transport)),
  u: Schema.optional(Schema.String),
  nut10: Schema.optional(Nut10),
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

/**
 * The `i` of a NUT-18 request, which the payer echoes as the payload's `id`.
 * The requester picks it; it is not a Nostr event id.
 */
export const PaymentRequestId = Schema.Trimmed.check(Schema.isNonEmpty()).pipe(
  Schema.brand("PaymentRequestId"),
);
export type PaymentRequestId = typeof PaymentRequestId.Type;

const isPaymentRequestId = Schema.is(PaymentRequestId);

const paymentRequestIdOrNull = (
  value: string | null | undefined,
): PaymentRequestId | null => {
  const trimmed = trimmedOrNull(value);
  return trimmed !== null && isPaymentRequestId(trimmed) ? trimmed : null;
};

export interface NostrPaymentRequestArgs {
  /** Sats requested; null leaves the amount to the payer. */
  readonly amount: number | null;
  readonly mintUrls: ReadonlyArray<string>;
  /** Where the payer sends the token, as a NIP-17 message. */
  readonly recipientNprofile: string;
  /** Lets the payee match the payment to this request. */
  readonly requestId: PaymentRequestId;
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
  const description = trimmedOrNull(args.description);
  const payload: Payload = {
    ...(args.amount === null ? {} : { a: args.amount }),
    u: "sat",
    s: true,
    m: [...new Set(args.mintUrls.flatMap((mint) => trimmedOrNull(mint) ?? []))],
    t: [{ t: "nostr", a: args.recipientNprofile, g: [["n", "17"]] }],
    i: args.requestId,
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

/** NUT-10 spending condition the payer has to lock the proofs with. */
export interface PaymentRequestLock {
  /** `P2PK` or `HTLC` in NUT-10; as sent. */
  readonly kind: string;
  /** The condition's data, a public key for `P2PK`. */
  readonly data: string;
  readonly tags: ReadonlyArray<ReadonlyArray<string>>;
}

/** A way the payee can melt the ecash out (`sm`), with what that costs it. */
export interface PaymentRequestMethod {
  /** `bolt11`, `bolt12` or `onchain` in NUT-18; as sent, lowercased. */
  readonly method: string;
  /** Sats the payer adds when paying from a mint outside `mints` (`mf`). */
  readonly fee: number;
}

export interface DecodedPaymentRequest {
  /** The trimmed `creqA…` text. */
  readonly encoded: string;
  readonly amount: number | null;
  /** Lowercased. */
  readonly unit: string | null;
  readonly singleUse: boolean | null;
  readonly mints: ReadonlyArray<string>;
  /** `mp`: the payee also accepts other mints, preferring `mints`; false without `mints`. */
  readonly mintsAdvisory: boolean;
  readonly methods: ReadonlyArray<PaymentRequestMethod>;
  readonly description: string | null;
  readonly id: PaymentRequestId | null;
  readonly transports: ReadonlyArray<PaymentRequestTransport>;
  /** Null for bearer proofs. */
  readonly lock: PaymentRequestLock | null;
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
  const mints = (decoded.m ?? []).flatMap((mint) => trimmedOrNull(mint) ?? []);
  return {
    encoded,
    amount: decoded.a ?? null,
    unit: trimmedOrNull(decoded.u)?.toLowerCase() ?? null,
    singleUse: decoded.s ?? null,
    mints,
    mintsAdvisory: decoded.mp === true && mints.length > 0,
    methods: (decoded.sm ?? []).map((method) => ({
      method: method.mn.trim().toLowerCase(),
      fee: Math.max(0, method.mf ?? 0),
    })),
    description: trimmedOrNull(decoded.d),
    id: paymentRequestIdOrNull(decoded.i),
    transports: (decoded.t ?? []).map((transport) => ({
      type: transport.t.trim(),
      target: transport.a.trim(),
      tags: transport.g ?? [],
    })),
    lock:
      decoded.nut10 === undefined
        ? null
        : {
            kind: decoded.nut10.k.trim(),
            data: decoded.nut10.d.trim(),
            tags: decoded.nut10.t ?? [],
          },
  };
};

/** The NUT-18 payment payload a payer sends to a request's transport. */
export interface PaymentRequestPayload {
  /** The `id` of the request it pays. */
  readonly id?: PaymentRequestId | null | undefined;
  readonly memo?: string | null | undefined;
  readonly mint: string;
  readonly unit: string;
  /** `SendReceipt.proofs`; they keep full keyset ids, which the payee needs. */
  readonly proofs: ReadonlyArray<{
    readonly id: string;
    readonly amount: number;
    readonly secret: string;
    readonly C: string;
  }>;
}

/**
 * The payload as the JSON text every transport carries: the body of a
 * `post`, the content of a `nostr` message. `id` and `memo` are left out
 * when empty.
 */
export const encodePaymentRequestPayload = (
  payload: PaymentRequestPayload,
): string => {
  const memo = trimmedOrNull(payload.memo);
  return JSON.stringify({
    ...(payload.id ? { id: payload.id } : {}),
    ...(memo === null ? {} : { memo }),
    mint: payload.mint,
    unit: payload.unit,
    proofs: payload.proofs,
  });
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
  readonly requestId: PaymentRequestId | null;
  readonly mint: string;
  readonly unit: string;
  readonly memo: string | null;
  /** Face value of the proofs, before the mint's input fee. */
  readonly amount: number;
}

/**
 * The NUT-18 payment payload a payer sends over a transport
 * (`{id, memo, mint, unit, proofs}` JSON), for matching it to the request
 * by `requestId`.
 * Receive the text itself with `Receive.receive`, which accepts the same
 * JSON. Null for anything else, a bare `cashuA`/`cashuB` token included.
 */
export const decodePaymentRequestPayload = (
  text: string,
): PaymentRequestPayloadSummary | null =>
  Option.match(decodePaymentPayload(text.trim()), {
    onNone: () => null,
    onSome: (payload) => ({
      requestId: paymentRequestIdOrNull(payload.id),
      mint: payload.mint.trim(),
      unit: payload.unit.trim().toLowerCase(),
      memo: trimmedOrNull(payload.memo),
      amount: payload.proofs.reduce((sum, proof) => sum + proof.amount, 0),
    }),
  });
