import {
  activeNostrIdentityId,
  ContactId,
  createId,
  directConversationIdFor,
  linkyScopes,
  makeRecurringPaymentsRepository,
  mergeShardRows,
  laneOwnerFromMnemonic,
  type LinkyScope,
  type LinkyTable,
  type Owner,
} from "@linky-fit/linksync";
import {
  createEvoluShardDb,
  LinkyEvoluSchema,
} from "@linky-fit/linksync/evolu";
import type { AtomRegistry } from "@linky-fit/linkstr-react";
import {
  editPatch,
  readRecurringPaymentOrder,
} from "@linky-fit/recurring-payment";
import { Effect } from "effect";
import { recurringPaymentUpdate } from "../../app/lib/recurringPaymentStore";
import { platformAtom } from "../../app/state/platform";
import { evoluAtom, type OpenedEvolu } from "../../app/state/session/evolu";
import {
  readLinkyStore,
  setMessagesRotation,
} from "../../app/state/session/store";
import { makeLocalStorageKeyValueStore } from "../../platform/linkshu/localStorageKeyValueStore";
import { seedCashuHistory, type CashuHistory } from "./seedCashuHistory";

/**
 * Test-only entry point the Playwright suites reach through
 * `window.__linkyE2E`: seed rows under any owner (the legacy lanes an older
 * app version would write to), and read what the shards hold, without going
 * through the UI. Installed by `main.tsx` in dev builds and in builds with
 * `VITE_E2E=1`; production builds never define it.
 */
export interface LinkyE2eHooks {
  readonly setMessagesRotation: (enabled: boolean) => void;
  readonly appOwnerId: () => Promise<string>;
  /** Opts the owners of BIP-39 mnemonics into sync, as legacy lanes, and returns their ids, in order. */
  readonly useOwners: (
    mnemonics: ReadonlyArray<string>,
  ) => ReadonlyArray<string>;
  /** A raw Evolu upsert under the app owner or one a test named; resolves once the row is stored. */
  readonly upsert: (
    table: string,
    row: Readonly<Record<string, unknown>>,
    ownerId: string,
  ) => Promise<void>;
  /** Live rows of a table merged across the scope's visible shards. */
  readonly shardRows: (
    scope: string,
    table: string,
  ) => Promise<ReadonlyArray<Readonly<Record<string, unknown>>>>;
  /** The owner id of one shard of a scope, whether or not it is visible. */
  readonly shardOwnerId: (scope: string, index: number) => Promise<string>;
  /** Unsubscribes and deletes the local copy of shards outside every forgettable scope's window. */
  readonly forget: () => Promise<
    ReadonlyArray<{ scope: string; index: number }>
  >;
  readonly syncOwnerIds: () => Promise<ReadonlyArray<string>>;
  /** Whether the shard store is hydrated. */
  readonly hydrated: () => Promise<boolean>;
  readonly createId: () => string;
  readonly directConversationIdFor: (contactId: string) => string;
  readonly activeNostrIdentityId: string;
  /** Claims a lease through the wallet's KeyValueStore; null while another tab holds it. */
  readonly tryAcquireLease: (
    key: string,
    ttlMs: number,
  ) => Promise<string | null>;
  /** Restarts a recurring payment's schedule at `atSec`, as an edit would, but without the form's no-past rule. */
  readonly makeRecurringDue: (id: string, atSec: number) => Promise<void>;
  /** Fills the cashu shards with a long-lived wallet's spent history; resolves to the active shard index. */
  readonly seedCashuHistory: (history: CashuHistory) => Promise<number>;
}

declare global {
  interface Window {
    __linkyE2E?: LinkyE2eHooks;
  }
}

const isSchemaTable = (table: string): boolean => table in LinkyEvoluSchema;
const isScope = (scope: string): scope is LinkyScope => scope in linkyScopes;
const isShardTable = (scope: LinkyScope, table: string): table is LinkyTable =>
  linkyScopes[scope].tables.some((known) => known === table);

// removal gate in app/migrations/AGENTS.md
const upsert = (
  { evolu }: OpenedEvolu,
  owner: Owner,
  table: string,
  row: Readonly<Record<string, unknown>>,
): Promise<void> =>
  new Promise((resolve, reject) => {
    if (!isSchemaTable(table)) {
      reject(new Error(`unknown table ${table}`));
      return;
    }
    // Evolu's upsert is typed per table; the hook is table-dynamic.
    Reflect.apply(evolu.upsert, evolu, [
      table,
      row,
      { owner, onSuccess: resolve, onError: reject },
    ]);
  });

export const installLinkyE2eHooks = (
  registry: AtomRegistry.AtomRegistry,
): void => {
  const opened = (): OpenedEvolu => {
    const evolu = registry.get(evoluAtom);
    if (evolu === null) throw new Error("No Evolu database while signed out");
    return evolu;
  };
  let shardDb: ReturnType<typeof createEvoluShardDb> | null = null;
  const db = () => {
    const { evolu, run, hasEvoluRelay } = opened();
    shardDb ??= createEvoluShardDb(evolu, {
      syncState: run.deps.syncState,
      hasEvoluRelay,
    });
    return shardDb;
  };
  // The owners a test named, which `upsert` writes under.
  const owners = new Map<string, Owner>();
  const ownerOf = (ownerId: string): Owner => {
    const { appOwner } = opened().evolu;
    const owner = ownerId === appOwner.id ? appOwner : owners.get(ownerId);
    if (owner === undefined) throw new Error(`unknown owner ${ownerId}`);
    return owner;
  };
  const getLinkyStore = () => readLinkyStore(registry);
  const walletStore = makeLocalStorageKeyValueStore();
  window.__linkyE2E = {
    setMessagesRotation: (enabled) => {
      if (!registry.get(platformAtom).config.isE2e)
        throw new Error("E2E build required");
      setMessagesRotation(enabled);
    },
    appOwnerId: () => Promise.resolve(opened().evolu.appOwner.id),
    useOwners: (mnemonics) =>
      mnemonics.map((mnemonic) => {
        const owner = laneOwnerFromMnemonic(mnemonic);
        if (owner === null) throw new Error("not a mnemonic");
        owners.set(owner.id, owner);
        opened().evolu.useOwner(owner);
        return owner.id;
      }),
    upsert: (table, row, ownerId) =>
      upsert(opened(), ownerOf(ownerId), table, row),
    shardRows: async (scope, table) => {
      if (!isScope(scope)) throw new Error(`unknown scope ${scope}`);
      if (!isShardTable(scope, table))
        throw new Error(`${table} is not in scope ${scope}`);
      const store = await getLinkyStore();
      const shards = await Effect.runPromise(store.visibleShards(scope));
      const rows = await Effect.runPromise(db().readTable(table));
      return mergeShardRows(
        rows,
        new Map(shards.map((shard) => [shard.owner.id, shard.index])),
      )
        .filter((row) => row.isDeleted !== 1)
        .map((row) => Object.fromEntries(Object.entries(row)));
    },
    shardOwnerId: async (scope, index) => {
      if (!isScope(scope)) throw new Error(`unknown scope ${scope}`);
      const owner = (await getLinkyStore()).shardOwner(scope, index);
      owners.set(owner.id, owner);
      return owner.id;
    },
    forget: async () => {
      const store = await getLinkyStore();
      return [...(await Effect.runPromise(store.forget()))];
    },
    syncOwnerIds: async () => {
      const store = await getLinkyStore();
      return (await Effect.runPromise(store.syncOwners())).map(
        (owner) => owner.id,
      );
    },
    hydrated: async () => Effect.runPromise((await getLinkyStore()).hydrated),
    createId: () => createId(),
    directConversationIdFor: (contactId) => {
      const decoded = ContactId.fromUnknown(contactId);
      return decoded.ok ? directConversationIdFor(decoded.value) : "";
    },
    activeNostrIdentityId,
    tryAcquireLease: (key, ttlMs) =>
      Effect.runPromise(walletStore.tryAcquireLease(key, ttlMs)),
    makeRecurringDue: async (id, atSec) => {
      const payments = makeRecurringPaymentsRepository(await getLinkyStore());
      const order = (await Effect.runPromise(payments.all))
        .map(readRecurringPaymentOrder)
        .find((candidate) => candidate?.id === id);
      if (!order) throw new Error(`unknown recurring payment ${id}`);
      await Effect.runPromise(
        payments.update(order.id, {
          anchorAtSec: atSec,
          ...recurringPaymentUpdate(editPatch(order, atSec)),
        }),
      );
    },
    seedCashuHistory: async (history) =>
      seedCashuHistory(await getLinkyStore(), db().mutate, history),
  };
};
