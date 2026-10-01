import { Effect, Order, Result, Schema } from "effect";
import type {
  Announcement,
  CompanySnapshot,
  CompanySubscription,
  Fetch,
  RefreshResult,
} from "./domain";
import { KeryxJoinUrlInvalid, KeryxMetadataInvalid } from "./errors";
import type { KeryxError } from "./errors";
import { identityChange, identityFromCustom } from "./identity";
import { catalogOf, channelRoles, syncChannel } from "./internal/channels";
import {
  authorizedPatterns,
  matchPattern,
  syncPrivateFeed,
} from "./internal/privateFeeds";
import { loadRepository } from "./internal/repository";
import type { Repository } from "./internal/repository";
import {
  fetchAnchorRoot,
  parseTrustedRoot,
  walkRootChain,
} from "./internal/rootChain";
import { parseKeryxUrl } from "./internal/urls";
import { TargetsCustom } from "./internal/wire";

const decodeCustom = Schema.decodeUnknownResult(TargetsCustom);

const companyMetadata = (repository: Repository) =>
  decodeCustom(repository.targets.custom ?? {}).pipe(
    Result.mapError(
      () =>
        new KeryxMetadataInvalid({
          role: "targets",
          reason: "custom.company_name is missing",
        }),
    ),
    Result.map((custom) => ({
      identity: identityFromCustom(custom),
      catalog: catalogOf(repository.targets, custom.channels ?? {}),
      patterns: authorizedPatterns(custom),
    })),
  );

/**
 * Pair with a confirmed join origin: pin its well-known root (TOFU), verify
 * the whole metadata chain and return what the consent summary may show.
 * Fetches no announcements; call `refreshCompany` after the user subscribes.
 */
export const pairCompany = (options: {
  readonly origin: string;
  readonly privateFeeds?: ReadonlyArray<string>;
  readonly fetch: Fetch;
  readonly now: Date;
}): Effect.Effect<CompanySnapshot, KeryxError | KeryxJoinUrlInvalid> =>
  Effect.gen(function* () {
    const origin = parseKeryxUrl(options.origin)?.origin;
    if (origin === undefined) {
      return yield* new KeryxJoinUrlInvalid({ reason: "not an HTTPS origin" });
    }
    const anchor = yield* fetchAnchorRoot(options.fetch, origin);
    const walk = yield* walkRootChain({
      fetch: options.fetch,
      origin,
      trusted: anchor,
      pairing: true,
    });
    if (walk._tag === "Suspended") {
      return yield* new KeryxMetadataInvalid({
        role: "root",
        reason: walk.reason,
      });
    }
    const repository = yield* loadRepository({
      fetch: options.fetch,
      now: options.now,
      root: walk.root,
    });
    const { identity, catalog, patterns } = yield* Effect.fromResult(
      companyMetadata(repository),
    );
    return {
      origin,
      trust: repository.trust,
      identity,
      catalog,
      privateFeeds: (options.privateFeeds ?? []).map((url) => ({
        url,
        info: matchPattern(patterns, url)?.info ?? null,
      })),
    };
  });

const newestFirst = Order.flip(
  Order.mapInput(Order.Number, (announcement: Announcement) =>
    Date.parse(announcement.datePublished),
  ),
);

/**
 * Refresh a paired company: walk the root chain from the pinned root, verify
 * the metadata chain against the trusted versions, then sync followed channels
 * and private feeds. Pass the previous `announcements` as `known`: unchanged
 * items are re-verified without downloading, and anything that cannot be
 * refreshed right now stays as it was.
 */
export const refreshCompany = (options: {
  readonly subscription: CompanySubscription;
  readonly known?: ReadonlyArray<Announcement>;
  readonly fetch: Fetch;
  readonly now: Date;
}): Effect.Effect<RefreshResult, KeryxError> =>
  Effect.gen(function* () {
    const { subscription, fetch, now } = options;
    const known = options.known ?? [];
    const pinned = yield* Effect.fromResult(
      parseTrustedRoot(subscription.trust.rootJson),
    );
    const walk = yield* walkRootChain({
      fetch,
      origin: subscription.origin,
      trusted: pinned,
      pairing: false,
    });
    if (walk._tag === "Suspended") return walk;
    const repository = yield* loadRepository({
      fetch,
      now,
      root: walk.root,
      previous: { root: pinned, trust: subscription.trust },
    });
    const { identity, catalog, patterns } = yield* Effect.fromResult(
      companyMetadata(repository),
    );
    const change = identityChange(subscription.identity, identity);
    if (change === "rebrand") {
      return {
        _tag: "Rebranded",
        previousIdentity: subscription.identity,
        identity,
      } as const;
    }

    const roles = channelRoles(repository.targets);
    const channels = yield* Effect.forEach(
      subscription.channels,
      (channel) => {
        const found = roles.get(channel);
        return found === undefined
          ? Effect.succeed({
              sync: { channel, status: "removed", problems: [] } as const,
              announcements: [],
            })
          : syncChannel({
              fetch,
              now,
              repository,
              channel,
              roles: found,
              known,
            });
      },
      { concurrency: 4 },
    );
    const privateFeeds = yield* Effect.forEach(
      subscription.privateFeeds,
      (state) => syncPrivateFeed({ fetch, now, state, patterns, known }),
      { concurrency: 4 },
    );
    return {
      _tag: "Refreshed",
      trust: repository.trust,
      identity,
      identityChange: change,
      catalog,
      channels: channels.map(({ sync }) => sync),
      privateFeeds: privateFeeds.map(({ sync }) => sync),
      announcements: [...channels, ...privateFeeds]
        .flatMap((result) => result.announcements)
        .sort(newestFirst),
    } as const;
  });
