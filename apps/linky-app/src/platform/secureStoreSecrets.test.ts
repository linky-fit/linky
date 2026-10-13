import { afterEach, describe, expect, it, vi } from "vitest";
import { testPlatformPorts } from "../testUtils/appRegistry";
import {
  makeNativeSecretsPort,
  SecretsWriteFailed,
  writeSecureSecretSet,
  type WritableSecureStore,
} from "./secureStoreSecrets";
import { loadSession } from "./session";

vi.mock("../utils/pushNsecStorage", () => ({
  setStoredPushNsec: () => Promise.resolve(),
  clearStoredPushNsec: () => Promise.resolve(),
}));

afterEach(() => vi.useRealTimers());

const storeAnswering = (answer: () => Promise<string | null>) =>
  makeNativeSecretsPort({ getItemAsync: answer });

describe("makeNativeSecretsPort", () => {
  it("finds a stored secret", async () => {
    const secrets = storeAnswering(() => Promise.resolve("nsec1secure"));
    await expect(secrets.read("linky.nostr_nsec")).resolves.toEqual({
      _tag: "Found",
      value: "nsec1secure",
    });
  });

  it.each([null, "", "  "])("reads %j as missing", async (stored) => {
    const secrets = storeAnswering(() => Promise.resolve(stored));
    await expect(secrets.read("linky.nostr_nsec")).resolves.toEqual({
      _tag: "Missing",
    });
  });

  it("reports a failed read as unavailable with the store's error", async () => {
    const secrets = storeAnswering(() =>
      Promise.reject(new Error("User interaction is not allowed")),
    );
    await expect(secrets.read("linky.nostr_nsec")).resolves.toEqual({
      _tag: "Unavailable",
      cause: "User interaction is not allowed",
    });
  });

  it("asks the user at boot when the store never answers", async () => {
    vi.useFakeTimers();
    const session = loadSession(
      testPlatformPorts({
        secrets: storeAnswering(() => new Promise(() => {})),
      }),
    );
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(session).resolves.toMatchObject({
      _tag: "SecretsUnavailable",
      cause: expect.stringContaining("linky.nostr_nsec: timed out"),
    });
  });
});

/** An in-memory secure store that refuses to write the keys in `refusing`. */
const memoryStore = (
  initial: Record<string, string>,
  refusing: ReadonlyArray<string> = [],
) => {
  const values = new Map(Object.entries(initial));
  const store: WritableSecureStore = {
    getItemAsync: (key) => Promise.resolve(values.get(key) ?? null),
    setItemAsync: (key, value) =>
      refusing.includes(key)
        ? Promise.reject(new Error("keystore refused"))
        : Promise.resolve(void values.set(key, value)),
    deleteItemAsync: (key) => Promise.resolve(void values.delete(key)),
  };
  return { store, values };
};

describe("writeSecureSecretSet", () => {
  it("stores the whole set and removes the keys of empty values", async () => {
    const { store, values } = memoryStore({ "linky.attached": "nsec1old" });

    await writeSecureSecretSet(store, {
      "linky.nostr_nsec": "nsec1new",
      "linky.attached": "",
    });

    expect(Object.fromEntries(values)).toEqual({
      "linky.nostr_nsec": "nsec1new",
    });
  });

  it("puts the previous values back and rejects when the store refuses one of them", async () => {
    const { store, values } = memoryStore({ "linky.nostr_nsec": "nsec1old" }, [
      "linky.slip39",
    ]);

    const written = writeSecureSecretSet(store, {
      "linky.nostr_nsec": "nsec1new",
      "linky.slip39": "words",
      "linky.cashu": "mnemonic",
    });

    await expect(written).rejects.toEqual(
      new SecretsWriteFailed(["linky.slip39"]),
    );
    expect(Object.fromEntries(values)).toEqual({
      "linky.nostr_nsec": "nsec1old",
    });
  });

  it("leaves a key whose previous value it could not read as the write left it", async () => {
    const { store, values } = memoryStore({}, ["linky.slip39"]);
    const unreadable: WritableSecureStore = {
      ...store,
      getItemAsync: (key) =>
        key === "linky.cashu"
          ? Promise.reject(new Error("locked"))
          : store.getItemAsync(key),
    };

    await expect(
      writeSecureSecretSet(unreadable, {
        "linky.slip39": "words",
        "linky.cashu": "mnemonic",
      }),
    ).rejects.toBeInstanceOf(SecretsWriteFailed);
    expect(Object.fromEntries(values)).toEqual({ "linky.cashu": "mnemonic" });
  });
});
