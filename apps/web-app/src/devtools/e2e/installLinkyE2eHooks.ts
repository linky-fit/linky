import {
  activeNostrIdentityId,
  appOwnerFromMnemonic,
  ContactId,
  createId,
  directConversationIdFor,
  linkyScopes,
  mergeShardRows,
  type LinkyScope,
  type LinkyTable,
} from "@linky/linksync";
import { createEvoluShardDb } from "@linky/linksync/evolu";
import { Effect } from "effect";
import { evolu, getLinkyStore, Schema } from "../../evolu";

/**
 * Test-only entry point the Playwright suites reach through
 * `window.__linkyE2E`: seed rows under any owner (the legacy lanes an older
 * app version would write to), and read what the shards hold, without going
 * through the UI. Installed by `main.tsx` in dev builds and in builds with
 * `VITE_E2E=1`; production builds never define it.
 */
export interface LinkyE2eHooks {
  readonly appOwnerId: () => Promise<string>;
  /** Opts BIP-39 mnemonics' app owners into sync and returns their ids, in order. */
  readonly useOwners: (
    mnemonics: ReadonlyArray<string>,
  ) => ReadonlyArray<string>;
  /** A raw Evolu upsert under the given owner; resolves once the row is applied. */
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
  /** Unsubscribes the shards outside every forgettable scope's window. */
  readonly forget: () => Promise<
    ReadonlyArray<{ scope: string; index: number; deleted: boolean }>
  >;
  readonly syncOwnerIds: () => Promise<ReadonlyArray<string>>;
  readonly createId: () => string;
  readonly directConversationIdFor: (contactId: string) => string;
  readonly activeNostrIdentityId: string;
}

declare global {
  interface Window {
    __linkyE2E?: LinkyE2eHooks;
  }
}

const isSchemaTable = (table: string): boolean => table in Schema;
const isScope = (scope: string): scope is LinkyScope => scope in linkyScopes;
const isShardTable = (scope: LinkyScope, table: string): table is LinkyTable =>
  linkyScopes[scope].tables.some((known) => known === table);

const isMutationResult = (
  value: unknown,
): value is { readonly ok: boolean; readonly error?: unknown } =>
  typeof value === "object" &&
  value !== null &&
  typeof Reflect.get(value, "ok") === "boolean";

const upsert: LinkyE2eHooks["upsert"] = (table, row, ownerId) =>
  new Promise((resolve, reject) => {
    if (!isSchemaTable(table)) {
      reject(new Error(`unknown table ${table}`));
      return;
    }
    // Evolu's upsert is typed per table; the hook is table-dynamic and Evolu
    // validates the row at runtime.
    const mutation = Reflect.get(evolu, "upsert");
    if (typeof mutation !== "function") {
      reject(new Error("evolu.upsert is missing"));
      return;
    }
    const result: unknown = Reflect.apply(mutation, evolu, [
      table,
      row,
      { ownerId, onComplete: () => resolve() },
    ]);
    if (!isMutationResult(result) || !result.ok)
      reject(new Error(`upsert rejected: ${JSON.stringify(result)}`));
  });

export const installLinkyE2eHooks = (): void => {
  const db = createEvoluShardDb(evolu);
  window.__linkyE2E = {
    appOwnerId: () => evolu.appOwner.then((owner) => owner.id),
    useOwners: (mnemonics) =>
      mnemonics.map((mnemonic) => {
        const owner = appOwnerFromMnemonic(mnemonic);
        if (owner === null) throw new Error("not a mnemonic");
        evolu.useOwner(owner);
        return owner.id;
      }),
    upsert,
    shardRows: async (scope, table) => {
      if (!isScope(scope)) throw new Error(`unknown scope ${scope}`);
      if (!isShardTable(scope, table))
        throw new Error(`${table} is not in scope ${scope}`);
      const store = await getLinkyStore();
      const shards = await Effect.runPromise(store.visibleShards(scope));
      const rows = await Effect.runPromise(db.readTable(table));
      return mergeShardRows(
        rows,
        new Map(shards.map((shard) => [shard.owner.id, shard.index])),
      )
        .filter((row) => row.isDeleted !== 1)
        .map((row) => Object.fromEntries(Object.entries(row)));
    },
    shardOwnerId: async (scope, index) => {
      if (!isScope(scope)) throw new Error(`unknown scope ${scope}`);
      const store = await getLinkyStore();
      return store.shardOwner(scope, index).id;
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
    createId: () => createId(),
    directConversationIdFor: (contactId) => {
      const decoded = ContactId.fromUnknown(contactId);
      return decoded.ok ? directConversationIdFor(decoded.value) : "";
    },
    activeNostrIdentityId,
  };
};
