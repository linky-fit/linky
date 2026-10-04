import { Effect, Either } from "effect";
import type { Fetch } from "../domain";
import { KeryxMetadataInvalid } from "../errors";
import type { KeryxFetchFailed } from "../errors";
import { publicKeysById } from "./crypto";
import { fetchBytes, isMissing } from "./fetchBytes";
import { decodeSigned, meetsThreshold, parseEnvelope } from "./metadata";
import type { Authority, SignatureEntry } from "./metadata";
import { RootSigned } from "./wire";

const MAX_ROOT_BYTES = 512 * 1024;
const MAX_ROOT_ROTATIONS = 256;

export interface TrustedRoot {
  readonly json: string;
  readonly signed: RootSigned;
  readonly message: Uint8Array;
}

export const rootAuthority = (
  signed: RootSigned,
  role: keyof RootSigned["roles"],
): Authority => ({
  keys: publicKeysById(signed.keys),
  ...signed.roles[role],
});

interface DecodedRoot {
  readonly root: TrustedRoot;
  readonly signatures: ReadonlyArray<SignatureEntry>;
}

const decodeRoot = (
  bytes: Uint8Array,
): Either.Either<DecodedRoot, KeryxMetadataInvalid> =>
  Either.gen(function* () {
    const envelope = yield* parseEnvelope("root", bytes);
    const signed = yield* decodeSigned("root", RootSigned, envelope.signed);
    const root = {
      json: new TextDecoder().decode(bytes),
      signed,
      message: envelope.message,
    };
    return { root, signatures: envelope.signatures };
  });

const signedBy = (
  root: TrustedRoot,
  { root: candidate, signatures }: DecodedRoot,
): boolean =>
  meetsThreshold(
    rootAuthority(root.signed, "root"),
    signatures,
    candidate.message,
  );

/** A root from storage: it was verified when it was pinned. */
export const parseTrustedRoot = (
  json: string,
): Either.Either<TrustedRoot, KeryxMetadataInvalid> =>
  decodeRoot(new TextEncoder().encode(json)).pipe(
    Either.map(({ root }) => root),
  );

const decodeSelfSignedRoot = (
  bytes: Uint8Array,
): Either.Either<DecodedRoot, KeryxMetadataInvalid> =>
  decodeRoot(bytes).pipe(
    Either.filterOrLeft(
      (decoded) => signedBy(decoded.root, decoded),
      () =>
        new KeryxMetadataInvalid({
          role: "root",
          reason: "root is not signed by its own root keys",
        }),
    ),
  );

/** TOFU: the anchor's root is trusted by location, but must still sign itself. */
export const parseAnchorRoot = (
  bytes: Uint8Array,
): Either.Either<TrustedRoot, KeryxMetadataInvalid> =>
  decodeSelfSignedRoot(bytes).pipe(Either.map(({ root }) => root));

type RootStep =
  | { readonly _tag: "Chained"; readonly root: TrustedRoot }
  | { readonly _tag: "Unchainable"; readonly version: number };

/** TUF root rotation: the next root must be signed by both the trusted and its own root keys. */
const nextRoot = (
  trusted: TrustedRoot,
  bytes: Uint8Array,
): Either.Either<RootStep, KeryxMetadataInvalid> =>
  Either.gen(function* () {
    const decoded = yield* decodeSelfSignedRoot(bytes);
    const candidate = decoded.root;
    if (!signedBy(trusted, decoded)) {
      return {
        _tag: "Unchainable",
        version: candidate.signed.version,
      } as const;
    }
    const expected = trusted.signed.version + 1;
    if (candidate.signed.version !== expected) {
      return yield* Either.left(
        new KeryxMetadataInvalid({
          role: "root",
          reason: `${expected}.root.json carries version ${candidate.signed.version}`,
        }),
      );
    }
    return { _tag: "Chained", root: candidate } as const;
  });

export const anchorUrl = (origin: string, file: string): URL =>
  new URL(`/.well-known/keryx/${file}`, origin);

export type RootWalk =
  | { readonly _tag: "Trusted"; readonly root: TrustedRoot }
  | {
      readonly _tag: "Suspended";
      readonly rootVersion: number;
      readonly reason: string;
    };

const sameBytes = (left: Uint8Array, right: Uint8Array): boolean =>
  left.length === right.length && left.every((byte, i) => byte === right[i]);

/**
 * Walk `N.root.json` from the join origin's well-known anchor, never from the
 * repo base. While pairing every failure is an error; after pairing a fetch
 * or parse failure only stops the walk (the pinned root stays in force) and
 * only a validly signed, unchainable root suspends the company: a next
 * `N.root.json` not signed by the walked root, or a `root.json` that forks
 * the walked version or, where the chain ends, is the next version and does
 * not chain. Further ahead, the missing link fails the walk until it is served.
 */
export const walkRootChain = (options: {
  readonly fetch: Fetch;
  readonly origin: string;
  readonly trusted: TrustedRoot;
  readonly pairing: boolean;
}): Effect.Effect<RootWalk, KeryxFetchFailed | KeryxMetadataInvalid> =>
  Effect.gen(function* () {
    let root = options.trusted;
    let missingLink: KeryxFetchFailed | undefined;
    for (let step = 0; step < MAX_ROOT_ROTATIONS; step++) {
      const next = `${root.signed.version + 1}.root.json`;
      const fetched = yield* Effect.either(
        fetchBytes(
          options.fetch,
          anchorUrl(options.origin, next),
          MAX_ROOT_BYTES,
        ),
      );
      if (Either.isLeft(fetched)) {
        if (isMissing(fetched.left)) missingLink = fetched.left;
        if (missingLink !== undefined || !options.pairing) break;
        return yield* fetched.left;
      }
      const verified = nextRoot(root, fetched.right);
      if (Either.isLeft(verified)) {
        if (!options.pairing) break;
        return yield* verified.left;
      }
      if (verified.right._tag === "Unchainable") {
        if (options.pairing) {
          return yield* new KeryxMetadataInvalid({
            role: "root",
            reason: `${next} does not chain to the anchor root`,
          });
        }
        return {
          _tag: "Suspended",
          rootVersion: verified.right.version,
          reason: `${next} is validly signed but not by the pinned root keys`,
        };
      }
      root = verified.right.root;
    }
    if (options.pairing) return { _tag: "Trusted", root };
    const anchor = yield* Effect.either(
      fetchBytes(
        options.fetch,
        anchorUrl(options.origin, "root.json"),
        MAX_ROOT_BYTES,
      ),
    );
    if (Either.isLeft(anchor)) return { _tag: "Trusted", root };
    const current = parseAnchorRoot(anchor.right);
    if (Either.isLeft(current)) return { _tag: "Trusted", root };
    const version = current.right.signed.version;
    if (
      version === root.signed.version &&
      !sameBytes(current.right.message, root.message)
    ) {
      return {
        _tag: "Suspended",
        rootVersion: version,
        reason: "root.json is a different root with the pinned version",
      };
    }
    if (missingLink === undefined || version <= root.signed.version) {
      return { _tag: "Trusted", root };
    }
    // A CDN may still serve a cached 404 for a published `N.root.json`, so a
    // newer root whose chain cannot be walked yet is unavailable, not unchainable.
    if (version > root.signed.version + 1) return yield* missingLink;
    const step = nextRoot(root, anchor.right);
    if (Either.isLeft(step)) return { _tag: "Trusted", root };
    if (step.right._tag === "Chained") {
      return { _tag: "Trusted", root: step.right.root };
    }
    return {
      _tag: "Suspended",
      rootVersion: version,
      reason: `root.json has version ${version} and does not chain to the pinned root`,
    };
  });

export const fetchAnchorRoot = (
  fetch: Fetch,
  origin: string,
): Effect.Effect<TrustedRoot, KeryxFetchFailed | KeryxMetadataInvalid> =>
  fetchBytes(fetch, anchorUrl(origin, "root.json"), MAX_ROOT_BYTES).pipe(
    Effect.flatMap(parseAnchorRoot),
  );
