import { appOwnerFromMnemonic } from "@linky-fit/linksync";
import { describe, expect, it, vi } from "vitest";
import { memoryKvPorts } from "../testUtils/appRegistry";
import {
  migrateLegacySecrets,
  withUnmigratedSecrets,
  type LegacySecretStore,
} from "./legacySecrets";
import { makeNativeSecretsPort } from "./secureStoreSecrets";
import { loadSession } from "./session";

vi.mock("../utils/pushNsecStorage", () => ({
  setStoredPushNsec: () => Promise.resolve(),
  clearStoredPushNsec: () => Promise.resolve(),
}));

const APP_MNEMONIC =
  "diet swift world sand heart donate squeeze never inner glove ability exist";
const awaitingKey = `linky.shards.awaitingFirstHydration.${appOwnerFromMnemonic(APP_MNEMONIC)?.id}`;

const LEGACY = {
  "linky.nostr_nsec": "nsec1legacy",
  "linky.nostr_slip39_seed": "slip39 words",
  "linky.cashu_bip85_mnemonic": "cashu words",
  "linky.initialMnemonic": APP_MNEMONIC,
};

const legacyStore = (
  read: () => Promise<Readonly<Record<string, string>>>,
): LegacySecretStore & { cleared: boolean } => {
  const store = {
    cleared: false,
    hasLegacySecrets: () => !store.cleared,
    readLegacySecrets: read,
    clearLegacySecrets: () => {
      store.cleared = true;
      return Promise.resolve();
    },
  };
  return store;
};

const secureStore = (
  initial: Record<string, string> = {},
  { refuse = [] }: { readonly refuse?: ReadonlyArray<string> } = {},
) => {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItemAsync: (key: string) => Promise.resolve(items.get(key) ?? null),
    setItemAsync: (key: string, value: string) => {
      if (refuse.includes(key))
        return Promise.reject(new Error("Keystore refused"));
      items.set(key, value);
      return Promise.resolve();
    },
    deleteItemAsync: (key: string) => {
      items.delete(key);
      return Promise.resolve();
    },
  };
};

const migrate = async ({
  legacy = legacyStore(() => Promise.resolve(LEGACY)),
  store = secureStore(),
  kv = {},
}: {
  readonly legacy?: ReturnType<typeof legacyStore> | null;
  readonly store?: ReturnType<typeof secureStore>;
  readonly kv?: Record<string, string>;
} = {}) => {
  const { items, ports } = memoryKvPorts(kv);
  const unmigrated = await migrateLegacySecrets({
    legacy,
    store,
    kv: ports.kv,
  });
  return { unmigrated, kv: items, store: store.items, ports };
};

describe("migrateLegacySecrets", () => {
  it("copies every secret into an empty secure store and waits for the first hydration", async () => {
    const legacy = legacyStore(() => Promise.resolve(LEGACY));
    const { unmigrated, kv, store } = await migrate({ legacy });
    expect(unmigrated.size).toBe(0);
    expect(Object.fromEntries(store)).toEqual(LEGACY);
    expect(kv.get(awaitingKey)).toBe("1");
    expect(kv.get("linky.app_mnemonic_state.v1")).toBe("present");
    expect(kv.get("linky.legacySecrets.migrated")).toBe("1");
    expect(legacy.cleared).toBe(true);
  });

  it("fills only the keys the secure store misses", async () => {
    const store = secureStore({
      "linky.nostr_nsec": "nsec1legacy",
      "linky.cashu_bip85_mnemonic": "cashu words kept",
    });
    const { unmigrated } = await migrate({ store });
    expect(unmigrated.size).toBe(0);
    expect(Object.fromEntries(store.items)).toEqual({
      ...LEGACY,
      "linky.cashu_bip85_mnemonic": "cashu words kept",
    });
  });

  it("leaves the hydration alone when a previous boot already moved the app mnemonic", async () => {
    const { kv } = await migrate({
      store: secureStore({ "linky.initialMnemonic": APP_MNEMONIC }),
    });
    expect(kv.has(awaitingKey)).toBe(false);
  });

  it("does nothing once migrated", async () => {
    const read = vi.fn(() => Promise.resolve(LEGACY));
    const { store } = await migrate({
      legacy: legacyStore(read),
      kv: { "linky.legacySecrets.migrated": "1" },
    });
    expect(read).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it.each([
    ["without a Capacitor store", null],
    [
      "with an empty Capacitor store",
      {
        ...legacyStore(() => Promise.resolve({})),
        hasLegacySecrets: () => false,
      },
    ],
  ])("only marks the migration done %s", async (_, legacy) => {
    const { unmigrated, kv } = await migrate({ legacy });
    expect(unmigrated.size).toBe(0);
    expect(Object.fromEntries(kv)).toEqual({
      "linky.legacySecrets.migrated": "1",
    });
  });

  it.each([
    [
      "can't be decrypted",
      () => Promise.reject(new Error("AEADBadTagException")),
    ],
    [
      "holds no nsec",
      () => Promise.resolve({ "linky.cashu_bip85_mnemonic": "x" }),
    ],
  ])(
    "reads every missing key as unavailable when the old store %s, and retries on the next boot",
    async (_, read) => {
      const legacy = legacyStore(read);
      const { unmigrated, kv } = await migrate({ legacy });
      expect([...unmigrated].sort()).toEqual([
        "linky.cashu_bip85_mnemonic",
        "linky.initialMnemonic",
        "linky.nostr_attached_nsec",
        "linky.nostr_nsec",
        "linky.nostr_slip39_seed",
      ]);
      expect(kv.has("linky.legacySecrets.migrated")).toBe(false);
      expect(legacy.cleared).toBe(false);
    },
  );

  it("drops an unreadable old store once the secure store holds an identity", async () => {
    const legacy = legacyStore(() => Promise.reject(new Error("bad keyset")));
    const { unmigrated, kv } = await migrate({
      legacy,
      store: secureStore({ "linky.nostr_nsec": "nsec1restored" }),
    });
    expect(unmigrated.size).toBe(0);
    expect(kv.get("linky.legacySecrets.migrated")).toBe("1");
    expect(legacy.cleared).toBe(true);
  });

  it("takes nothing into a secure store holding another identity", async () => {
    const { unmigrated, store } = await migrate({
      store: secureStore({ "linky.nostr_nsec": "nsec1other" }),
    });
    expect(unmigrated.size).toBe(0);
    expect(Object.fromEntries(store)).toEqual({
      "linky.nostr_nsec": "nsec1other",
    });
  });

  it("reports refused writes as unmigrated and keeps the old store for the next boot", async () => {
    const legacy = legacyStore(() => Promise.resolve(LEGACY));
    const { unmigrated, kv, store } = await migrate({
      legacy,
      store: secureStore({}, { refuse: ["linky.cashu_bip85_mnemonic"] }),
    });
    expect([...unmigrated]).toEqual(["linky.cashu_bip85_mnemonic"]);
    expect(store.has("linky.cashu_bip85_mnemonic")).toBe(false);
    expect(kv.get(awaitingKey)).toBe("1");
    expect(kv.has("linky.legacySecrets.migrated")).toBe(false);
    expect(legacy.cleared).toBe(false);
  });

  it("asks the user at boot, never onboards, when the old store can't be read", async () => {
    const store = secureStore();
    const { unmigrated, ports } = await migrate({
      legacy: legacyStore(() => Promise.reject(new Error("bad keyset"))),
      store,
    });
    const session = await loadSession({
      ...ports,
      secrets: withUnmigratedSecrets(makeNativeSecretsPort(store), unmigrated),
    });
    expect(session._tag).toBe("SecretsUnavailable");
  });
});

describe("withUnmigratedSecrets", () => {
  const secrets = withUnmigratedSecrets(
    { read: () => Promise.resolve({ _tag: "Missing" }) },
    new Set(["linky.nostr_nsec"]),
  );

  it("reads an unmigrated missing key as unavailable", async () => {
    await expect(secrets.read("linky.nostr_nsec")).resolves.toMatchObject({
      _tag: "Unavailable",
    });
  });

  it("leaves other keys missing", async () => {
    await expect(secrets.read("linky.nostr_slip39_seed")).resolves.toEqual({
      _tag: "Missing",
    });
  });
});
