import { Effect, Result, Schema } from "effect";
import type { Fetch } from "../domain";
import { KeryxMetadataExpired, KeryxMetadataInvalid } from "../errors";
import type { KeryxFetchFailed } from "../errors";
import { canonicalJsonBytes } from "./canonicalJson";
import { hexToBytesOrNull, sha256Hex, verifyEd25519 } from "./crypto";
import { fetchBytes, parseJsonBytes } from "./fetchBytes";
import { Envelope } from "./wire";
import type { MetaFile } from "./wire";

/** Who may sign a role: keys resolved by keyid, and how many must sign. */
export interface Authority {
  readonly keys: ReadonlyMap<string, Uint8Array>;
  readonly keyids: ReadonlyArray<string>;
  readonly threshold: number;
}

export interface SignatureEntry {
  readonly keyid: string;
  readonly sig: string;
}

/** Distinct authorized keys that signed, and whether an authorized key's signature failed. */
export const checkSignatures = (
  authority: Authority,
  signatures: ReadonlyArray<SignatureEntry>,
  message: Uint8Array,
  decodeSignature: (sig: string) => Uint8Array | null,
): { readonly valid: number; readonly authorizedInvalid: boolean } => {
  const authorized = new Set(authority.keyids);
  const valid = new Set<string>();
  let authorizedInvalid = false;
  for (const { keyid, sig } of signatures) {
    const key = authority.keys.get(keyid);
    if (!authorized.has(keyid) || key === undefined) continue;
    const signature = decodeSignature(sig);
    if (signature !== null && verifyEd25519(key, signature, message)) {
      valid.add(keyid);
    } else {
      authorizedInvalid = true;
    }
  }
  return { valid: valid.size, authorizedInvalid };
};

export const meetsThreshold = (
  authority: Authority,
  signatures: ReadonlyArray<SignatureEntry>,
  message: Uint8Array,
): boolean =>
  checkSignatures(authority, signatures, message, hexToBytesOrNull).valid >=
  authority.threshold;

export interface ParsedEnvelope {
  readonly signed: Readonly<Record<string, unknown>>;
  readonly signatures: ReadonlyArray<SignatureEntry>;
  /** The canonical bytes the signatures cover. */
  readonly message: Uint8Array;
}

const decodeEnvelope = Schema.decodeUnknownResult(Envelope);

export const parseEnvelope = (
  role: string,
  bytes: Uint8Array,
): Result.Result<ParsedEnvelope, KeryxMetadataInvalid> => {
  const envelope = decodeEnvelope(parseJsonBytes(bytes));
  if (Result.isFailure(envelope)) {
    return Result.fail(
      new KeryxMetadataInvalid({ role, reason: "not a signed metadata file" }),
    );
  }
  const message = canonicalJsonBytes(envelope.success.signed);
  return message === null
    ? Result.fail(
        new KeryxMetadataInvalid({ role, reason: "not canonical JSON" }),
      )
    : Result.succeed({ ...envelope.success, message });
};

export const decodeSigned = <A>(
  role: string,
  schema: Schema.Decoder<A>,
  signed: unknown,
): Result.Result<A, KeryxMetadataInvalid> =>
  Schema.decodeUnknownResult(schema)(signed).pipe(
    Result.mapError(
      (error) => new KeryxMetadataInvalid({ role, reason: error.message }),
    ),
  );

export const isExpired = (expires: string, now: Date): boolean =>
  Date.parse(expires) <= now.getTime();

export const checkPinned = (
  role: string,
  bytes: Uint8Array,
  pinned: MetaFile | undefined,
): Result.Result<void, KeryxMetadataInvalid> => {
  if (pinned?.length !== undefined && bytes.length !== pinned.length) {
    return Result.fail(
      new KeryxMetadataInvalid({
        role,
        reason: "length differs from snapshot",
      }),
    );
  }
  const expected = pinned?.hashes?.["sha256"];
  return expected !== undefined && sha256Hex(bytes) !== expected
    ? Result.fail(
        new KeryxMetadataInvalid({
          role,
          reason: "hash differs from snapshot",
        }),
      )
    : Result.void;
};

export interface LoadMetadata<A> {
  readonly fetch: Fetch;
  readonly now: Date;
  readonly role: string;
  readonly url: URL;
  readonly maxBytes: number;
  readonly pinned?: MetaFile;
  readonly schema: Schema.Decoder<A>;
  readonly authority: Authority;
}

/** Fetch one non-root metadata file and verify it: pin, threshold, type, pinned version, expiry. */
export const loadMetadata = <
  A extends { readonly version: number; readonly expires: string },
>(
  options: LoadMetadata<A>,
): Effect.Effect<
  A,
  KeryxFetchFailed | KeryxMetadataInvalid | KeryxMetadataExpired
> =>
  Effect.gen(function* () {
    const { role, pinned } = options;
    const bytes = yield* fetchBytes(
      options.fetch,
      options.url,
      pinned?.length ?? options.maxBytes,
    );
    yield* Effect.fromResult(checkPinned(role, bytes, pinned));
    const envelope = yield* Effect.fromResult(parseEnvelope(role, bytes));
    if (
      !meetsThreshold(options.authority, envelope.signatures, envelope.message)
    ) {
      return yield* new KeryxMetadataInvalid({
        role,
        reason: "signature threshold not met",
      });
    }
    const signed = yield* Effect.fromResult(
      decodeSigned(role, options.schema, envelope.signed),
    );
    if (pinned !== undefined && signed.version !== pinned.version) {
      return yield* new KeryxMetadataInvalid({
        role,
        reason: `version ${signed.version} is not the pinned ${pinned.version}`,
      });
    }
    if (isExpired(signed.expires, options.now)) {
      return yield* new KeryxMetadataExpired({ role, expires: signed.expires });
    }
    return signed;
  });
