import {
  appOwnerFromMnemonic,
  linkyTableColumns,
  makeInMemoryShardDb,
  makeSettingsRepository,
  type LinkyDbSchema,
} from "@linky-fit/linksync";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
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

const openAccount = (hasEvoluRelay = true) => {
  const db = makeInMemoryShardDb<LinkyDbSchema>(linkyTableColumns, {
    holdSync: true,
  });
  const store = createAccountStore(db, appOwner, { hasEvoluRelay });
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

afterEach(() => localStorage.clear());

describe("createAccountStore", () => {
  it("writes at once on a device without the marker, as one upgraded or a new account", async () => {
    const account = openAccount();
    await settle();
    expect(account.written()).toBe(true);
  });

  it("holds writes of a restored account until it hydrates, which ends the wait", async () => {
    markAwaitingFirstHydration(mnemonic);
    expect(localStorage.getItem(key)).toBe("1");
    const account = openAccount();
    await settle();
    expect(account.written()).toBe(false);

    account.hydrate();
    await settle();
    expect(account.written()).toBe(true);
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("keeps a restored account unhydrated while no Evolu relay is enabled", async () => {
    markAwaitingFirstHydration(mnemonic);
    const account = openAccount(false);
    account.hydrate();
    await settle();
    expect(account.written()).toBe(false);
    expect(localStorage.getItem(key)).toBe("1");
  });
});
