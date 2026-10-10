import {
  linkshuServices,
  P2pkUnlockingKey,
  QuoteLockingKey,
  type LinkshuServices,
} from "@linky-fit/linkshu";
import { decodeNsec } from "@linky-fit/linkstr";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  Context,
  Effect,
  Exit,
  Layer,
  Option,
  Schema,
  Scope,
  Semaphore,
} from "effect";
import { Atom } from "effect/reactivity";
import { linkshuAppInspector } from "../../../devtools/inspector/linkshuInspector";
import { localStorageKeyValueStore } from "../../../platform/linkshu/localStorageKeyValueStore";
import { resolveLinkshuSeed } from "../../../platform/linkshu/resolveLinkshuSeed";
import { migrateLegacyCashuLocalState } from "../../migrations/linkshuStorageMigration";
import { sessionAtom, sessionSecrets } from "../session/session";
import { walletRepositoryAtom } from "../session/store";

export class LinkshuNotConfigured extends Schema.TaggedError<LinkshuNotConfigured>()(
  "LinkshuNotConfigured",
  {},
) {}

/**
 * The session's wallet seed. Computed once per page load: on an nsec-only
 * login it generates and persists a cashu mnemonic, which a second
 * resolution must not replace. Not configured while the session could not
 * read the mnemonic it would come from.
 */
export const linkshuSeedAtom = Atom.keepAlive(
  Atom.make((get) => {
    const session = get.once(sessionAtom);
    if (session._tag !== "SignedIn")
      return Effect.fail(new LinkshuNotConfigured());
    return Effect.suspend(() => {
      // Before the seed, so the runtime sees the copied counters. Removal gate in app/migrations/AGENTS.md.
      migrateLegacyCashuLocalState();
      return Effect.promise(() => resolveLinkshuSeed(session));
    }).pipe(
      Effect.flatMap((seed) =>
        seed === null
          ? Effect.fail(new LinkshuNotConfigured())
          : Effect.succeed(seed),
      ),
      Effect.tapDefect((defect) =>
        Effect.sync(() =>
          console.warn("[linky] linkshu seed resolution failed", defect),
        ),
      ),
    );
  }),
);

/** Topup polling fibers run here, so they die with the runtime, before its services. */
export class WalletScope extends Context.Service<WalletScope, Scope.Scope>()(
  "linky/WalletScope",
) {
  static readonly layer = Layer.effect(
    WalletScope,
    Effect.acquireRelease(Scope.make(), (scope) =>
      Scope.close(scope, Exit.void),
    ),
  );
}

/**
 * The nostr key locks NUT-20 quotes (topups and npub.cash lock theirs to it)
 * and signs for tokens P2PK-locked to the user's npub (NUT-11). It reaches
 * linkshu only as a mint-call argument.
 */
export const nostrKeyOptionsOf = (nsec: string | null) => {
  const secretKey = nsec ? decodeNsec(nsec) : null;
  if (secretKey === null) return { lockingOptions: {}, unlockOptions: {} };
  const hex = bytesToHex(secretKey);
  return {
    lockingOptions: { lockingKey: QuoteLockingKey.make(hex) },
    unlockOptions: { unlockingKey: P2pkUnlockingKey.make(hex) },
  };
};

/** The session's nostr key as linkshu mint-call options; see `nostrKeyOptionsOf`. */
export class NostrKeyOptions extends Context.Service<
  NostrKeyOptions,
  ReturnType<typeof nostrKeyOptionsOf>
>()("linky/NostrKeyOptions") {
  static readonly layer = (nsec: string | null) =>
    Layer.succeed(NostrKeyOptions, nostrKeyOptionsOf(nsec));
}

/** Runs one wallet operation at a time; one started while another runs is dropped (`None`). */
export class WalletOpQueue extends Context.Service<
  WalletOpQueue,
  {
    readonly runExclusive: <A, E, R>(
      operation: Effect.Effect<A, E, R>,
    ) => Effect.Effect<Option.Option<A>, E, R>;
  }
>()("linky/WalletOpQueue") {
  static readonly layer = Layer.effect(
    WalletOpQueue,
    Effect.map(Semaphore.make(1), (semaphore) => ({
      runExclusive: semaphore.withPermitsIfAvailable(1),
    })),
  );
}

export type LinkshuEnv =
  | LinkshuServices
  | WalletScope
  | NostrKeyOptions
  | WalletOpQueue;

/**
 * linkshu over the session's seed and the shard wallet repository, with the
 * app inspector bridged in. Kept alive so a running send or topup outlives
 * the screens that started it. `Layer.fresh` keeps a rebuild from reusing
 * services memoized for the previous seed or repository.
 */
export const linkshuRuntimeAtom = Atom.keepAlive(
  Atom.runtime((get) =>
    Layer.unwrap(
      Effect.gen(function* () {
        const bip39Seed = yield* get.result(linkshuSeedAtom);
        const wallet = yield* get.result(walletRepositoryAtom);
        const services = linkshuServices({
          bip39Seed,
          keyValueStore: localStorageKeyValueStore,
          proofStore: wallet.proofStore,
          operationStore: wallet.operationStore,
        }).pipe(Layer.provideMerge(linkshuAppInspector));
        // Built over the services, so its scope closes before they shut down.
        return Layer.fresh(
          Layer.mergeAll(
            WalletScope.layer,
            NostrKeyOptions.layer(
              sessionSecrets(get.once(sessionAtom))?.nsec ?? null,
            ),
            WalletOpQueue.layer,
          ).pipe(Layer.provideMerge(services)),
        );
      }),
    ),
  ),
);
