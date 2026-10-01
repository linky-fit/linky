import { Effect, Option, Result, Schema } from "effect";
import type {
  Announcement,
  Channel,
  ChannelSync,
  Fetch,
  ItemProblem,
} from "../domain";
import { publicKeysById, sha256Hex } from "./crypto";
import { fetchBytes, MAX_DOCUMENT_BYTES } from "./fetchBytes";
import { loadMetadata } from "./metadata";
import type { Authority } from "./metadata";
import { metadataUrl } from "./repository";
import type { Repository } from "./repository";
import { verifyChannelItem } from "./items";
import { CHANNEL_NAME, ChannelDisplay, TargetsSigned } from "./wire";
import type { DelegatedRole, TargetFile } from "./wire";
import { describeError } from "./describeError";

export interface ChannelRoles {
  readonly role: DelegatedRole;
  readonly authors?: DelegatedRole;
}

const ROLE_PREFIX = "channels.";
const AUTHORS_SUFFIX = ".authors";

// TUF glob: `*` matches within one path segment, never across `/`.
const globMatches = (pattern: string, path: string): boolean =>
  new RegExp(
    `^${pattern
      .split("*")
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join("[^/]*")}$`,
  ).test(path);

const staysInNamespace = (role: DelegatedRole, channel: string): boolean =>
  role.paths.length > 0 &&
  role.paths.every((path) => {
    const [prefix, name, file, ...rest] = path.split("/");
    return (
      prefix === "channels" &&
      name === channel &&
      file !== undefined &&
      file !== "" &&
      rest.length === 0
    );
  });

/**
 * Channels are delegated roles named `channels.<name>` whose paths stay in
 * `channels/<name>/`; `channels.<name>.authors` authorizes item signing.
 * Every other role is ignored, and so is a channel whose authors role leaves
 * its namespace, rather than falling back to simple mode.
 */
export const channelRoles = (
  targets: TargetsSigned,
): ReadonlyMap<string, ChannelRoles> => {
  const roles = new Map<string, DelegatedRole>();
  for (const role of targets.delegations.roles) {
    if (role.name.startsWith(ROLE_PREFIX) && !roles.has(role.name)) {
      roles.set(role.name, role);
    }
  }
  const channels = new Map<string, ChannelRoles>();
  for (const [name, role] of roles) {
    const channel = name.slice(ROLE_PREFIX.length);
    const authors = roles.get(`${name}${AUTHORS_SUFFIX}`);
    if (
      !CHANNEL_NAME.test(channel) ||
      !staysInNamespace(role, channel) ||
      (authors !== undefined && !staysInNamespace(authors, channel))
    ) {
      continue;
    }
    channels.set(channel, authors === undefined ? { role } : { role, authors });
  }
  return channels;
};

const decodeDisplay = Schema.decodeUnknownOption(ChannelDisplay);

export const catalogOf = (
  targets: TargetsSigned,
  displays: Readonly<Record<string, unknown>>,
): ReadonlyArray<Channel> =>
  [...channelRoles(targets).keys()].map((name) => {
    const display = Option.getOrUndefined(decodeDisplay(displays[name]));
    return {
      name,
      displayName: display?.display_name ?? name,
      ...(display?.description === undefined
        ? {}
        : { description: display.description }),
    };
  });

const authorityOf = (
  role: DelegatedRole,
  targets: TargetsSigned,
): Authority => ({
  keys: publicKeysById(targets.delegations.keys),
  keyids: role.keyids,
  threshold: role.threshold,
});

const targetUrl = (
  repository: Repository,
  path: string,
  sha256: string,
): URL => {
  if (!repository.root.signed.consistent_snapshot) {
    return new URL(path, repository.base);
  }
  const slash = path.lastIndexOf("/");
  return new URL(
    `${path.slice(0, slash + 1)}${sha256}.${path.slice(slash + 1)}`,
    repository.base,
  );
};

const encoder = new TextEncoder();

interface ItemOutcome {
  readonly announcement?: Announcement;
  readonly problem?: ItemProblem;
}

export interface ChannelResult {
  readonly sync: ChannelSync;
  readonly announcements: ReadonlyArray<Announcement>;
}

/**
 * One followed channel: verify its index, then every item it pins. Items
 * missing from the index are gone; cached items whose bytes still match are
 * re-verified without downloading. A transient download failure keeps the
 * cached copy of that item; a failing signature drops it.
 */
export const syncChannel = (options: {
  readonly fetch: Fetch;
  readonly now: Date;
  readonly repository: Repository;
  readonly channel: string;
  readonly roles: ChannelRoles;
  readonly known: ReadonlyArray<Announcement>;
}): Effect.Effect<ChannelResult> =>
  Effect.gen(function* () {
    const { repository, channel, roles } = options;
    const { targets, snapshot } = repository;
    const itemAuthority = authorityOf(roles.authors ?? roles.role, targets);
    const known = new Map(
      options.known
        .filter(
          (announcement) =>
            announcement.channel === channel &&
            announcement.privateFeedUrl === undefined &&
            announcement.itemFile !== undefined,
        )
        .map((announcement) => [announcement.id, announcement]),
    );
    const reverify = (id: string, cached: Announcement) =>
      verifyChannelItem({
        bytes: encoder.encode(cached.itemFile),
        channel,
        id,
        authority: itemAuthority,
      });
    const cachedAnnouncements = [...known].flatMap(([id, cached]) =>
      Result.getSuccess(reverify(id, cached)).pipe(Option.toArray),
    );

    const roleFile = `${roles.role.name}.json`;
    const pinned = snapshot.meta[roleFile];
    if (pinned === undefined) {
      return {
        sync: {
          channel,
          status: "unavailable",
          reason: `${roleFile} is not in the snapshot`,
          problems: [],
        },
        announcements: cachedAnnouncements,
      } satisfies ChannelResult;
    }
    const index = yield* Effect.result(
      loadMetadata({
        fetch: options.fetch,
        now: options.now,
        role: roles.role.name,
        url: metadataUrl(repository, roleFile, pinned),
        maxBytes: MAX_DOCUMENT_BYTES,
        pinned,
        schema: TargetsSigned,
        authority: authorityOf(roles.role, targets),
      }),
    );
    if (Result.isFailure(index)) {
      return {
        sync: {
          channel,
          status: "unavailable",
          reason: describeError(index.failure),
          problems: [],
        },
        announcements: cachedAnnouncements,
      } satisfies ChannelResult;
    }

    const syncItem = (path: string, file: TargetFile) =>
      Effect.gen(function* () {
        const dropped = (reason: string): ItemOutcome => ({
          problem: { path, reason, keptCachedCopy: false },
        });
        const verified = (result: Result.Result<Announcement, string>) =>
          Result.match(result, {
            onFailure: dropped,
            onSuccess: (announcement): ItemOutcome => ({ announcement }),
          });
        const id = path.match(/^channels\/[^/]+\/([^/]+)\.json$/)?.[1];
        if (
          id === undefined ||
          !path.startsWith(`channels/${channel}/`) ||
          !roles.role.paths.some((pattern) => globMatches(pattern, path))
        ) {
          return dropped("outside the channel namespace");
        }
        const cached = known.get(id);
        if (
          cached?.itemFile !== undefined &&
          sha256Hex(encoder.encode(cached.itemFile)) === file.hashes.sha256
        ) {
          return verified(reverify(id, cached));
        }
        const keepCached = (reason: string): ItemOutcome => {
          const kept =
            cached === undefined
              ? Option.none()
              : Result.getSuccess(reverify(id, cached));
          return Option.match(kept, {
            onNone: () => dropped(reason),
            onSome: (announcement) => ({
              announcement,
              problem: { path, reason, keptCachedCopy: true },
            }),
          });
        };
        if (file.length > MAX_DOCUMENT_BYTES) {
          return dropped("larger than the item size limit");
        }
        const bytes = yield* Effect.result(
          fetchBytes(
            options.fetch,
            targetUrl(repository, path, file.hashes.sha256),
            file.length,
          ),
        );
        if (Result.isFailure(bytes)) return keepCached(bytes.failure.reason);
        if (
          bytes.success.length !== file.length ||
          sha256Hex(bytes.success) !== file.hashes.sha256
        ) {
          return keepCached("bytes differ from the pinned hash or length");
        }
        return verified(
          verifyChannelItem({
            bytes: bytes.success,
            channel,
            id,
            authority: itemAuthority,
          }),
        );
      });

    const outcomes = yield* Effect.forEach(
      Object.entries(index.success.targets),
      ([path, file]) => syncItem(path, file),
      { concurrency: 4 },
    );
    return {
      sync: {
        channel,
        status: "synced",
        problems: outcomes.flatMap(({ problem }) =>
          problem === undefined ? [] : [problem],
        ),
      },
      announcements: outcomes.flatMap(({ announcement }) =>
        announcement === undefined ? [] : [announcement],
      ),
    } satisfies ChannelResult;
  });
