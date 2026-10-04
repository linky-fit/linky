import {
  refreshCompany,
  type CompanyIdentity,
  type CompanySnapshot,
} from "@linky-fit/keryx";
import type { KeryxSubscriptionsRepository } from "@linky-fit/linksync";
import { Effect, Either, Struct } from "effect";
import React from "react";
import {
  emptyCacheEntry,
  nextCacheEntry,
  pairedCacheEntry,
  withFeedStates,
  type KeryxCacheEntry,
} from "../lib/keryxCache";
import {
  deleteKeryxCacheEntry,
  readKeryxCacheEntry,
  writeKeryxCacheEntry,
} from "../lib/keryxCacheStorage";
import {
  authorizedPrivateFeeds,
  channelsColumn,
  identityColumn,
  keryxSubscriptionInsert,
  mergePrivateFeeds,
  readKeryxCompany,
  trustWriteback,
  type KeryxCompany,
} from "../lib/keryxCompany";
import {
  keryxChannelsChangedRow,
  keryxIdentityAcknowledgedRow,
  keryxPairedRow,
  keryxRefreshRows,
  keryxUnpairedRow,
  reportKeryx,
} from "../lib/keryxInspector";
import { runWrite, type WriteOutcome } from "../lib/storeWrite";
import { nowSeconds } from "../../utils/time";
import {
  useKeryxSubscriptionRows,
  useKeryxSubscriptionsRepository,
} from "./useLinksync";

export interface KeryxState {
  /** Device-local caches by join origin, loaded from IndexedDB on first use. */
  readonly entries: ReadonlyMap<string, KeryxCacheEntry>;
  readonly refreshing: ReadonlySet<string>;
  /** The error tag of the last failed refresh, while the cache is shown. */
  readonly errors: ReadonlyMap<string, string>;
}

let state: KeryxState = {
  entries: new Map(),
  refreshing: new Set(),
  errors: new Map(),
};
const listeners = new Set<() => void>();

const update = (
  change: (draft: {
    entries: Map<string, KeryxCacheEntry>;
    refreshing: Set<string>;
    errors: Map<string, string>;
  }) => void,
): void => {
  const draft = {
    entries: new Map(state.entries),
    refreshing: new Set(state.refreshing),
    errors: new Map(state.errors),
  };
  change(draft);
  state = draft;
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getState = (): KeryxState => state;

const loadEntry = async (origin: string): Promise<KeryxCacheEntry> => {
  const loaded = state.entries.get(origin);
  if (loaded) return loaded;
  const stored = await readKeryxCacheEntry(origin).catch(() => null);
  const entry = state.entries.get(origin) ?? stored ?? emptyCacheEntry;
  update((draft) => draft.entries.set(origin, entry));
  return entry;
};

/** Keeps the entry in memory even where IndexedDB is unavailable. */
const saveEntry = async (
  origin: string,
  entry: KeryxCacheEntry,
): Promise<void> => {
  update((draft) => draft.entries.set(origin, entry));
  await writeKeryxCacheEntry(origin, entry).catch(() => undefined);
};

const dropEntry = async (origin: string): Promise<void> => {
  update((draft) => {
    draft.entries.delete(origin);
    draft.errors.delete(origin);
  });
  await deleteKeryxCacheEntry(origin).catch(() => undefined);
};

/** Refreshes requested while one of the origin was running; the newest request wins. */
const queuedRefreshes = new Map<string, KeryxCompany>();

/**
 * Refreshes one company against its join origin, replaces the cached
 * announcements and feed states and writes back trust that changed.
 * A failure keeps the cache and records the error for a notice.
 */
const refreshKeryxCompany = async (
  company: KeryxCompany,
  repository: KeryxSubscriptionsRepository,
): Promise<void> => {
  const { origin } = company.subscription;
  if (state.refreshing.has(origin)) {
    queuedRefreshes.set(origin, company);
    return;
  }
  update((draft) => draft.refreshing.add(origin));
  try {
    const previous = await loadEntry(origin);
    const subscription = withFeedStates(company.subscription, previous);
    const now = new Date();
    const outcome = await Effect.runPromise(
      Effect.either(
        refreshCompany({
          subscription,
          known: previous.announcements,
          fetch: globalThis.fetch,
          now,
        }),
      ),
    );
    reportKeryx(() => keryxRefreshRows(subscription, outcome));
    // `remove` drops the entry; the refresh must not write it back.
    if (!state.entries.has(origin)) return;
    if (Either.isLeft(outcome)) {
      update((draft) => draft.errors.set(origin, outcome.left._tag));
      return;
    }
    update((draft) => draft.errors.delete(origin));
    await saveEntry(origin, nextCacheEntry(previous, outcome.right, now));
    if (outcome.right._tag === "Refreshed") {
      const patch = trustWriteback(company, outcome.right);
      if (patch) await runWrite(repository.update(company.id, patch));
    }
  } catch {
    update((draft) => draft.errors.set(origin, "unexpected"));
  } finally {
    update((draft) => draft.refreshing.delete(origin));
    const queued = queuedRefreshes.get(origin);
    queuedRefreshes.delete(origin);
    if (queued && state.entries.has(origin))
      void refreshKeryxCompany(queued, repository);
  }
};

const byName = (a: KeryxCompany, b: KeryxCompany) =>
  a.subscription.identity.companyName.localeCompare(
    b.subscription.identity.companyName,
  );

/** The paired companies, their device-local caches and every Keryx write. */
export const useKeryx = () => {
  const repository = useKeryxSubscriptionsRepository();
  const records = useKeryxSubscriptionRows();
  const companies = React.useMemo(
    () =>
      records.flatMap((record) => readKeryxCompany(record) ?? []).sort(byName),
    [records],
  );
  const keryxState = React.useSyncExternalStore(subscribe, getState);

  React.useEffect(() => {
    for (const company of companies)
      void loadEntry(company.subscription.origin);
  }, [companies]);

  return React.useMemo(
    () => ({
      companies,
      state: keryxState,
      entryOf: (company: KeryxCompany): KeryxCacheEntry =>
        keryxState.entries.get(company.subscription.origin) ?? emptyCacheEntry,
      refresh: (company: KeryxCompany) =>
        refreshKeryxCompany(company, repository),
      pair: async (
        snapshot: CompanySnapshot,
        channels: ReadonlyArray<string>,
      ): Promise<WriteOutcome> => {
        const row = keryxSubscriptionInsert(snapshot, channels, nowSeconds());
        const outcome = await runWrite(repository.insert(row));
        if (!outcome.ok) return outcome;
        await saveEntry(snapshot.origin, pairedCacheEntry(snapshot));
        reportKeryx(() => [
          keryxPairedRow(
            snapshot.origin,
            channels,
            authorizedPrivateFeeds(snapshot).length,
          ),
        ]);
        return outcome;
      },
      addPrivateFeeds: (company: KeryxCompany, urls: ReadonlyArray<string>) => {
        const patch = mergePrivateFeeds(company, urls);
        return patch === null
          ? Promise.resolve<WriteOutcome>({ ok: true })
          : runWrite(repository.update(company.id, patch));
      },
      /** A newly followed channel is fetched right away. */
      setChannels: async (
        company: KeryxCompany,
        channels: ReadonlyArray<string>,
      ): Promise<WriteOutcome> => {
        reportKeryx(() => [
          keryxChannelsChangedRow(company.subscription.origin, channels),
        ]);
        const outcome = await runWrite(
          repository.update(company.id, {
            channelsJson: channelsColumn(channels),
          }),
        );
        const followed = new Set(company.subscription.channels);
        if (outcome.ok && channels.some((name) => !followed.has(name))) {
          void refreshKeryxCompany(
            { ...company, subscription: { ...company.subscription, channels } },
            repository,
          );
        }
        return outcome;
      },
      acknowledgeIdentity: async (
        company: KeryxCompany,
        identity: CompanyIdentity,
      ): Promise<WriteOutcome> => {
        const { origin } = company.subscription;
        const outcome = await runWrite(
          repository.update(company.id, {
            identityJson: identityColumn(identity),
          }),
        );
        if (!outcome.ok) return outcome;
        await saveEntry(
          origin,
          Struct.omit(await loadEntry(origin), "pendingIdentity"),
        );
        reportKeryx(() => [keryxIdentityAcknowledgedRow(origin, identity)]);
        return outcome;
      },
      remove: async (company: KeryxCompany): Promise<WriteOutcome> => {
        const { origin } = company.subscription;
        const outcome = await runWrite(repository.remove(company.id));
        if (!outcome.ok) return outcome;
        await dropEntry(origin);
        reportKeryx(() => [keryxUnpairedRow(origin)]);
        return outcome;
      },
    }),
    [companies, keryxState, repository],
  );
};

/** Refreshes each company once while the calling screen stays open, also those that arrive later. */
export const useRefreshOnOpen = (
  companies: ReadonlyArray<KeryxCompany>,
  refresh: (company: KeryxCompany) => Promise<void>,
): void => {
  const refreshed = React.useRef(new Set<string>());
  React.useEffect(() => {
    for (const company of companies) {
      if (refreshed.current.has(company.id)) continue;
      refreshed.current.add(company.id);
      void refresh(company);
    }
  }, [companies, refresh]);
};
