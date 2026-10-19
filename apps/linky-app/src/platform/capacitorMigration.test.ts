import { appOwnerFromMnemonic } from "@linky-fit/linksync";
import { describe, expect, it, vi } from "vitest";
import { memoryKvPorts } from "../testUtils/appRegistry";
import {
  migrateCapacitorApp,
  withUnmigratedSecrets,
  type CapacitorStores,
} from "./capacitorMigration";
import { makeNativeSecretsPort } from "./secureStoreSecrets";
import { loadSession } from "./session";

vi.mock("../utils/pushNsecStorage", () => ({
  setStoredPushNsec: () => Promise.resolve(),
  clearStoredPushNsec: () => Promise.resolve(),
}));

const APP_MNEMONIC =
  "diet swift world sand heart donate squeeze never inner glove ability exist";
const awaitingKey = `linky.shards.awaitingFirstHydration.${appOwnerFromMnemonic(APP_MNEMONIC)?.id}`;

const SECRETS = {
  "linky.nostr_nsec": "nsec1legacy",
  "linky.nostr_slip39_seed": "slip39 words",
  "linky.cashu_bip85_mnemonic": "cashu words",
  "linky.initialMnemonic": APP_MNEMONIC,
};

const ALL_SECRET_KEYS = [
  "linky.cashu_bip85_mnemonic",
  "linky.initialMnemonic",
  "linky.nostr_attached_nsec",
  "linky.nostr_nsec",
  "linky.nostr_slip39_seed",
];

type Read<A> = () => Promise<A>;

const capacitorStores = ({
  encrypted = () => Promise.resolve(SECRETS),
  hasEncrypted = true,
  web = () => Promise.resolve(null),
}: {
  readonly encrypted?: Read<Readonly<Record<string, string>>>;
  readonly hasEncrypted?: boolean;
  readonly web?: Read<string | null>;
} = {}): CapacitorStores & { cleared: boolean } => {
  const stores = {
    cleared: false,
    hasLegacySecrets: () => hasEncrypted && !stores.cleared,
    readLegacySecrets: encrypted,
    readLegacyWebStorage: () =>
      stores.cleared ? Promise.resolve(null) : web(),
    clearLegacyStores: () => {
      stores.cleared = true;
      return Promise.resolve();
    },
  };
  return stores;
};

const webStorage = (items: Record<string, string>) => () =>
  Promise.resolve(JSON.stringify(items));

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
  stores = capacitorStores(),
  store = secureStore(),
  kv = {},
}: {
  readonly stores?: ReturnType<typeof capacitorStores> | null;
  readonly store?: ReturnType<typeof secureStore>;
  readonly kv?: Record<string, string>;
} = {}) => {
  const { items, ports } = memoryKvPorts(kv);
  const unmigrated = await migrateCapacitorApp({
    stores,
    store,
    kv: ports.kv,
  });
  return { unmigrated, kv: items, store: store.items, ports };
};

describe("migrateCapacitorApp", () => {
  it("copies every secret into an empty secure store, waits for the first hydration and deletes the old stores", async () => {
    const stores = capacitorStores();
    const { unmigrated, kv, store } = await migrate({ stores });
    expect(unmigrated.size).toBe(0);
    expect(Object.fromEntries(store)).toEqual(SECRETS);
    expect(kv.get(awaitingKey)).toBe("1");
    expect(kv.get("linky.app_mnemonic_state.v1")).toBe("present");
    expect(kv.get("linky.legacySecrets.migrated")).toBe("1");
    expect(stores.cleared).toBe(true);
  });

  it("fills only the keys the secure store misses", async () => {
    const store = secureStore({
      "linky.nostr_nsec": "nsec1legacy",
      "linky.cashu_bip85_mnemonic": "cashu words kept",
    });
    const { unmigrated } = await migrate({ store });
    expect(unmigrated.size).toBe(0);
    expect(Object.fromEntries(store.items)).toEqual({
      ...SECRETS,
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
    const encrypted = vi.fn(() => Promise.resolve(SECRETS));
    const { store } = await migrate({
      stores: capacitorStores({ encrypted }),
      kv: { "linky.legacySecrets.migrated": "1" },
    });
    expect(encrypted).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it.each([
    ["without the native module", null],
    [
      "without anything the Capacitor app left",
      capacitorStores({ hasEncrypted: false }),
    ],
  ])("only marks the migration done %s", async (_, stores) => {
    const { unmigrated, kv } = await migrate({ stores });
    expect(unmigrated.size).toBe(0);
    expect(Object.fromEntries(kv)).toEqual({
      "linky.legacySecrets.migrated": "1",
    });
  });

  it("carries the WebView's settings, even when no secret arrives", async () => {
    const { kv } = await migrate({
      stores: capacitorStores({
        encrypted: () => Promise.reject(new Error("bad keyset")),
        web: webStorage({ "linky.lang": "cs", "linky.nostr_nsec": "" }),
      }),
    });
    expect(kv.get("linky.lang")).toBe("cs");
  });

  describe("the WebView's plaintext secrets", () => {
    it.each([
      ["are missing", { hasEncrypted: false }],
      [
        "can't be decrypted",
        { encrypted: () => Promise.reject(new Error("AEADBadTagException")) },
      ],
    ])("stand in when the encrypted preferences %s", async (_, encrypted) => {
      const stores = capacitorStores({
        ...encrypted,
        web: webStorage(SECRETS),
      });
      const { unmigrated, store } = await migrate({ stores });
      expect(unmigrated.size).toBe(0);
      expect(Object.fromEntries(store)).toEqual(SECRETS);
      expect(stores.cleared).toBe(true);
    });

    it("fill the encrypted preferences' gaps for the same nsec", async () => {
      const { store } = await migrate({
        stores: capacitorStores({
          encrypted: () =>
            Promise.resolve({ "linky.nostr_nsec": "nsec1legacy" }),
          web: webStorage(SECRETS),
        }),
      });
      expect(Object.fromEntries(store)).toEqual(SECRETS);
    });

    it("never mix into another identity's encrypted secrets", async () => {
      const { store } = await migrate({
        stores: capacitorStores({
          encrypted: () =>
            Promise.resolve({ "linky.nostr_nsec": "nsec1encrypted" }),
          web: webStorage(SECRETS),
        }),
      });
      expect(Object.fromEntries(store)).toEqual({
        "linky.nostr_nsec": "nsec1encrypted",
      });
    });
  });

  it("finishes for a logged-out Capacitor app whose WebView holds no secrets", async () => {
    const stores = capacitorStores({
      hasEncrypted: false,
      web: webStorage({ "linky.lang": "de" }),
    });
    const { unmigrated, kv } = await migrate({ stores });
    expect(unmigrated.size).toBe(0);
    expect(kv.get("linky.legacySecrets.migrated")).toBe("1");
    expect(stores.cleared).toBe(true);
  });

  it.each([
    [
      "the encrypted preferences can't be decrypted",
      { encrypted: () => Promise.reject(new Error("AEADBadTagException")) },
    ],
    [
      "the encrypted preferences hold no nsec",
      {
        encrypted: () => Promise.resolve({ "linky.cashu_bip85_mnemonic": "x" }),
      },
    ],
    [
      "the WebView can't be read",
      {
        hasEncrypted: false,
        web: () => Promise.reject(new Error("timed out")),
      },
    ],
    [
      "the WebView dump is no string map",
      { hasEncrypted: false, web: () => Promise.resolve("[1]") },
    ],
  ])(
    "reads every missing key as unavailable when %s, keeps the old stores and retries on the next boot",
    async (_, options) => {
      const stores = capacitorStores(options);
      const { unmigrated, kv } = await migrate({ stores });
      expect([...unmigrated].sort()).toEqual(ALL_SECRET_KEYS);
      expect(kv.has("linky.legacySecrets.migrated")).toBe(false);
      expect(stores.cleared).toBe(false);
    },
  );

  it("drops unreadable old stores once the secure store holds an identity", async () => {
    const stores = capacitorStores({
      encrypted: () => Promise.reject(new Error("bad keyset")),
    });
    const { unmigrated, kv } = await migrate({
      stores,
      store: secureStore({ "linky.nostr_nsec": "nsec1restored" }),
    });
    expect(unmigrated.size).toBe(0);
    expect(kv.get("linky.legacySecrets.migrated")).toBe("1");
    expect(stores.cleared).toBe(true);
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

  it("reports refused writes as unmigrated and keeps the old stores for the next boot", async () => {
    const stores = capacitorStores();
    const { unmigrated, kv, store } = await migrate({
      stores,
      store: secureStore({}, { refuse: ["linky.cashu_bip85_mnemonic"] }),
    });
    expect([...unmigrated]).toEqual(["linky.cashu_bip85_mnemonic"]);
    expect(store.has("linky.cashu_bip85_mnemonic")).toBe(false);
    expect(kv.get(awaitingKey)).toBe("1");
    expect(kv.has("linky.legacySecrets.migrated")).toBe(false);
    expect(stores.cleared).toBe(false);
  });

  it("asks the user at boot, never onboards, when no old store can be read", async () => {
    const store = secureStore();
    const { unmigrated, ports } = await migrate({
      stores: capacitorStores({
        encrypted: () => Promise.reject(new Error("bad keyset")),
      }),
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
