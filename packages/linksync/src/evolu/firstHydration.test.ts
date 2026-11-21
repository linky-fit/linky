import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { appOwnerFromMnemonic, makeInMemoryShardDb } from "../core";
import { linkyTableColumns, type LinkyDbSchema } from "../model";
import { makeSettingsRepository } from "../repositories";
import { memoryKeyValueStorage } from "../testing/keyValueStorage";
import {
  createAccountStore,
  markAwaitingFirstHydration,
} from "./firstHydration";

const mnemonic =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const appOwner = appOwnerFromMnemonic(mnemonic);
if (appOwner === null) throw new Error("invalid test mnemonic");
const key = `linky.shards.awaitingFirstHydration.${appOwner.id}`;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const openAccount = (
  kv: ReturnType<typeof memoryKeyValueStorage>,
  hasEvoluRelay = true,
) => {
  const db = makeInMemoryShardDb<LinkyDbSchema>(linkyTableColumns, {
    holdSync: true,
  });
  const store = createAccountStore(db, appOwner, { kv, hasEvoluRelay });
  Effect.runSync(store.reconcileSync());
  let written = false;
  void Effect.runPromise(
    makeSettingsRepository(store).set("allowTestMints", true),
  ).then(() => {
    written = true;
  });
  return {
    written: () => written,
    hydrate: () => {
      for (const owner of Effect.runSync(store.syncOwners()))
        db.finishSync(owner.id);
    },
  };
};

describe("createAccountStore", () => {
  it("writes at once on a device without the marker, as one upgraded or a new account", async () => {
    const account = openAccount(memoryKeyValueStorage());
    await settle();
    expect(account.written()).toBe(true);
  });

  it("holds writes of a restored account until it hydrates, which ends the wait", async () => {
    const kv = memoryKeyValueStorage();
    markAwaitingFirstHydration(kv, mnemonic);
    expect(kv.getItem(key)).toBeTruthy();
    const account = openAccount(kv);
    await settle();
    expect(account.written()).toBe(false);

    account.hydrate();
    await settle();
    expect(account.written()).toBe(true);
    expect(kv.getItem(key)).toBeNull();
  });

  it("does not clear a newer wipe marker when an older tab finishes hydrating", async () => {
    const kv = memoryKeyValueStorage();
    kv.setItem(key, "1");
    const oldTab = openAccount(kv);
    await settle();
    expect(oldTab.written()).toBe(false);

    markAwaitingFirstHydration(kv, mnemonic);
    const wipeMarker = kv.getItem(key);
    expect(wipeMarker).toBeTruthy();
    expect(wipeMarker).not.toBe("1");

    oldTab.hydrate();
    await settle();
    expect(kv.getItem(key)).toBe(wipeMarker);

    const replacementTab = openAccount(kv);
    await settle();
    expect(replacementTab.written()).toBe(false);
    replacementTab.hydrate();
    await settle();
    expect(replacementTab.written()).toBe(true);
    expect(kv.getItem(key)).toBeNull();
  });

  it("keeps a restored account unhydrated while no Evolu relay is enabled", async () => {
    const kv = memoryKeyValueStorage();
    markAwaitingFirstHydration(kv, mnemonic);
    const marker = kv.getItem(key);
    const account = openAccount(kv, false);
    account.hydrate();
    await settle();
    expect(account.written()).toBe(false);
    expect(kv.getItem(key)).toBe(marker);
  });

  it("marks nothing for text that is not a mnemonic", () => {
    const kv = memoryKeyValueStorage();
    markAwaitingFirstHydration(kv, "not a mnemonic");
    expect(kv.items.size).toBe(0);
  });
});
