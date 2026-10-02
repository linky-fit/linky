import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INITIAL_MNEMONIC_STORAGE_KEY } from "../mnemonic";
import {
  evoluDbNameFor,
  scheduleActiveEvoluDatabaseWipe,
  wipeScheduledEvoluDatabases,
} from "./evoluLocalDatabase";

const MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const OTHER_MNEMONIC =
  "legal winner thank year wave sausage worth useful legal winner thank yellow";
const PENDING_KEY = "linky.evoluDatabaseWipes.v1";

const removeEntry = vi.fn<(name: string) => Promise<void>>();
const heldLocks = new Set<string>();

const stubNavigator = (key: string, value: object) =>
  Object.defineProperty(navigator, key, { value, configurable: true });

const logInAs = (mnemonic: string | null) => {
  if (mnemonic) localStorage.setItem(INITIAL_MNEMONIC_STORAGE_KEY, mnemonic);
  else localStorage.removeItem(INITIAL_MNEMONIC_STORAGE_KEY);
};

const pendingWipes = (): unknown =>
  JSON.parse(localStorage.getItem(PENDING_KEY) ?? "null");

beforeEach(() => {
  stubNavigator("storage", {
    getDirectory: () => Promise.resolve({ removeEntry }),
  });
  stubNavigator("locks", {
    request: (name: string, _options: object, callback: () => Promise<void>) =>
      heldLocks.has(name)
        ? Promise.reject(new DOMException("timed out", "TimeoutError"))
        : callback(),
  });
  removeEntry.mockResolvedValue(undefined);
});

afterEach(() => {
  localStorage.clear();
  heldLocks.clear();
  removeEntry.mockReset();
});

describe("evolu local database wipe", () => {
  it("deletes a logged-out account's database on the next boot", async () => {
    logInAs(MNEMONIC);
    scheduleActiveEvoluDatabaseWipe();
    logInAs(null);

    await wipeScheduledEvoluDatabases();

    expect(removeEntry).toHaveBeenCalledWith(`.${evoluDbNameFor(MNEMONIC)}`, {
      recursive: true,
    });
    expect(pendingWipes()).toBeNull();
  });

  it("keeps a database another tab still has open scheduled", async () => {
    logInAs(MNEMONIC);
    scheduleActiveEvoluDatabaseWipe();
    logInAs(null);
    heldLocks.add(`evolu-sharedwebworker-${evoluDbNameFor(MNEMONIC)}`);

    await wipeScheduledEvoluDatabases();

    expect(removeEntry).not.toHaveBeenCalled();
    expect(pendingWipes()).toEqual([evoluDbNameFor(MNEMONIC)]);
  });

  it("treats an already deleted database as wiped", async () => {
    logInAs(MNEMONIC);
    scheduleActiveEvoluDatabaseWipe();
    logInAs(null);
    removeEntry.mockRejectedValue(new DOMException("gone", "NotFoundError"));

    await wipeScheduledEvoluDatabases();

    expect(pendingWipes()).toBeNull();
  });

  it("keeps the database of an account the user logged back into", async () => {
    logInAs(MNEMONIC);
    scheduleActiveEvoluDatabaseWipe();
    logInAs(OTHER_MNEMONIC);
    scheduleActiveEvoluDatabaseWipe();
    logInAs(MNEMONIC);

    await wipeScheduledEvoluDatabases();

    expect(removeEntry).toHaveBeenCalledTimes(1);
    expect(removeEntry).toHaveBeenCalledWith(
      `.${evoluDbNameFor(OTHER_MNEMONIC)}`,
      { recursive: true },
    );
    expect(pendingWipes()).toBeNull();
  });
});
