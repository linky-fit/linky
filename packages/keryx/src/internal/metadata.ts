import { Effect, Either, ParseResult, Schema } from "effect";
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

const decodeEnvelope = Schema.decodeUnknownEither(Envelope);

export const parseEnvelope = (
  role: string,
  bytes: Uint8Array,
): Either.Either<ParsedEnvelope, KeryxMetadataInvalid> => {
  const envelope = decodeEnvelope(parseJsonBytes(bytes));
  if (Either.isLeft(envelope)) {
    return Either.left(
      new KeryxMetadataInvalid({ role, reason: "not a signed metadata file" }),
    );
  }
  const message = canonicalJsonBytes(envelope.right.signed);
  return message === null
    ? Either.left(
        new KeryxMetadataInvalid({ role, reason: "not canonical JSON" }),
      )
    : Either.right({ ...envelope.right, message });
};

export const decodeSigned = <A, I>(
  role: string,
  schema: Schema.Schema<A, I>,
  signed: unknown,
): Either.Either<A, KeryxMetadataInvalid> =>
  Schema.decodeUnknownEither(schema)(signed).pipe(
    Either.mapLeft(
      (error) =>
        new KeryxMetadataInvalid({
          role,
          reason: ParseResult.TreeFormatter.formatErrorSync(error),
        }),
    ),
  );

export const isExpired = (expires: string, now: Date): boolean =>
  Date.parse(expires) <= now.getTime();

export const checkPinned = (
  role: string,
  bytes: Uint8Array,
  pinned: MetaFile | undefined,
): Either.Either<void, KeryxMetadataInvalid> => {
  if (pinned?.length !== undefined && bytes.length !== pinned.length) {
    return Either.left(
      new KeryxMetadataInvalid({
        role,
        reason: "length differs from snapshot",
      }),
    );
  }
  const expected = pinned?.hashes?.["sha256"];
  return expected !== undefined && sha256Hex(bytes) !== expected
    ? Either.left(
        new KeryxMetadataInvalid({
          role,
          reason: "hash differs from snapshot",
        }),
      )
    : Either.void;
};

export interface LoadMetadata<A, I> {
  readonly fetch: Fetch;
  readonly now: Date;
  readonly role: string;
  readonly url: URL;
  readonly maxBytes: number;
  readonly pinned?: MetaFile;
  readonly schema: Schema.Schema<A, I>;
  readonly authority: Authority;
}

/** Fetch one non-root metadata file and verify it: pin, threshold, type, pinned version, expiry. */
export const loadMetadata = <
  A extends { readonly version: number; readonly expires: string },
  I,
>(
  options: LoadMetadata<A, I>,
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
    yield* checkPinned(role, bytes, pinned);
    const envelope = yield* parseEnvelope(role, bytes);
    if (
      !meetsThreshold(options.authority, envelope.signatures, envelope.message)
    ) {
      return yield* new KeryxMetadataInvalid({
        role,
        reason: "signature threshold not met",
      });
    }
    const signed = yield* decodeSigned(role, options.schema, envelope.signed);
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
