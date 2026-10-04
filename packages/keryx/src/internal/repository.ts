import { Effect, Record } from "effect";
import type { CompanyTrust, Fetch } from "../domain";
import {
  KeryxLiteModeUnsupported,
  KeryxMetadataExpired,
  KeryxMetadataInvalid,
  KeryxRollbackDetected,
} from "../errors";
import type { KeryxError } from "../errors";
import { isExpired, loadMetadata } from "./metadata";
import { rootAuthority } from "./rootChain";
import type { TrustedRoot } from "./rootChain";
import { parseKeryxUrl } from "./urls";
import { SnapshotSigned, TargetsSigned, TimestampSigned } from "./wire";
import type { MetaFile, RootSigned } from "./wire";

const MAX_TIMESTAMP_BYTES = 64 * 1024;
const MAX_METADATA_BYTES = 4 * 1024 * 1024;

export interface Repository {
  readonly root: TrustedRoot;
  readonly base: URL;
  readonly snapshot: SnapshotSigned;
  readonly targets: TargetsSigned;
  readonly trust: CompanyTrust;
}

/** The URL of a metadata file, version-prefixed when the repo uses consistent snapshots. */
export const metadataUrl = (
  repository: Pick<Repository, "root" | "base">,
  file: string,
  pinned: MetaFile,
): URL =>
  new URL(
    repository.root.signed.consistent_snapshot
      ? `${pinned.version}.${file}`
      : file,
    repository.base,
  );

const repoBase = (root: RootSigned): URL | null => {
  const url = parseKeryxUrl(root.custom.repo_base);
  if (url === null || url.search !== "") return null;
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
};

const sameKeys = (left: RootSigned, right: RootSigned): boolean =>
  (["timestamp", "snapshot"] as const).every(
    (role) =>
      left.roles[role].threshold === right.roles[role].threshold &&
      [...left.roles[role].keyids].sort().join() ===
        [...right.roles[role].keyids].sort().join(),
  );

const checkVersion = (
  role: string,
  trustedVersion: number,
  receivedVersion: number,
): Effect.Effect<void, KeryxRollbackDetected> =>
  receivedVersion < trustedVersion
    ? Effect.fail(
        new KeryxRollbackDetected({ role, trustedVersion, receivedVersion }),
      )
    : Effect.void;

/**
 * Full-mode TUF update below the root: timestamp → snapshot → targets, each
 * verified against the root's keys, pinned by its parent and never older than
 * what `previous` trusted.
 */
export const loadRepository = (options: {
  readonly fetch: Fetch;
  readonly now: Date;
  readonly root: TrustedRoot;
  readonly previous?: {
    readonly root: TrustedRoot;
    readonly trust: CompanyTrust;
  };
}): Effect.Effect<Repository, KeryxError> =>
  Effect.gen(function* () {
    const { fetch, now, root } = options;
    if (isExpired(root.signed.expires, now)) {
      return yield* new KeryxMetadataExpired({
        role: "root",
        expires: root.signed.expires,
      });
    }
    if (root.signed.custom.mode === "lite") {
      return yield* new KeryxLiteModeUnsupported();
    }
    if (root.signed.custom.mode !== "full") {
      return yield* new KeryxMetadataInvalid({
        role: "root",
        reason: `unknown mode ${root.signed.custom.mode}`,
      });
    }
    const base = repoBase(root.signed);
    if (base === null) {
      return yield* new KeryxMetadataInvalid({
        role: "root",
        reason: "custom.repo_base is not an HTTPS URL",
      });
    }
    const previous = options.previous;
    // TUF: rotated timestamp/snapshot keys forget their old versions (fast-forward recovery).
    const memory =
      previous === undefined
        ? undefined
        : sameKeys(previous.root.signed, root.signed)
          ? previous.trust
          : { ...previous.trust, timestampVersion: 0, snapshotVersion: 0 };

    const timestamp = yield* loadMetadata({
      fetch,
      now,
      role: "timestamp",
      url: new URL("timestamp.json", base),
      maxBytes: MAX_TIMESTAMP_BYTES,
      schema: TimestampSigned,
      authority: rootAuthority(root.signed, "timestamp"),
    });
    const snapshotMeta = timestamp.meta["snapshot.json"];
    if (memory !== undefined) {
      yield* checkVersion(
        "timestamp",
        memory.timestampVersion,
        timestamp.version,
      );
      yield* checkVersion(
        "snapshot",
        memory.snapshotVersion,
        snapshotMeta.version,
      );
    }

    const snapshot = yield* loadMetadata({
      fetch,
      now,
      role: "snapshot",
      url: metadataUrl({ root, base }, "snapshot.json", snapshotMeta),
      maxBytes: MAX_METADATA_BYTES,
      pinned: snapshotMeta,
      schema: SnapshotSigned,
      authority: rootAuthority(root.signed, "snapshot"),
    });
    if (memory !== undefined) {
      for (const [file, version] of Object.entries(memory.metaVersions)) {
        const pinned = snapshot.meta[file];
        if (pinned !== undefined) {
          yield* checkVersion(file, version, pinned.version);
        }
      }
    }

    const targetsMeta = snapshot.meta["targets.json"];
    if (targetsMeta === undefined) {
      return yield* new KeryxMetadataInvalid({
        role: "snapshot",
        reason: "targets.json is not pinned",
      });
    }
    const targets = yield* loadMetadata({
      fetch,
      now,
      role: "targets",
      url: metadataUrl({ root, base }, "targets.json", targetsMeta),
      maxBytes: MAX_METADATA_BYTES,
      pinned: targetsMeta,
      schema: TargetsSigned,
      authority: rootAuthority(root.signed, "targets"),
    });

    return {
      root,
      base,
      snapshot,
      targets,
      trust: {
        rootJson: root.json,
        timestampVersion: timestamp.version,
        snapshotVersion: snapshot.version,
        // Dropped files stay remembered, so a re-added file cannot come back older.
        metaVersions: {
          ...memory?.metaVersions,
          ...Record.map(snapshot.meta, (meta) => meta.version),
        },
      },
    };
  });
