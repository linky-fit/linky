import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  createSlip39Seed,
  deriveNostrKeysFromSlip39,
} from "../utils/slip39Nostr";
import { triggerPasswordManagerSeedSave } from "./passwordManager";

interface SavedCredential {
  id: string;
  name?: string;
  password: string;
}

class TestPasswordCredential {
  readonly type = "password";
  readonly id: string;
  readonly name: string;
  readonly password: string;

  constructor(data: SavedCredential) {
    this.id = data.id;
    this.name = data.name ?? "";
    this.password = data.password;
  }
}

const vault = new Map<string, SavedCredential>();
let firstSeed = "";
let secondSeed = "";

beforeAll(async () => {
  const first = await createSlip39Seed();
  const second = await createSlip39Seed();
  if (!first || !second) throw new Error("Could not generate test identities");
  firstSeed = first;
  secondSeed = second;
});

beforeEach(() => {
  vault.clear();
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("PasswordCredential", TestPasswordCredential);
  vi.stubGlobal("navigator", {
    credentials: {
      store: vi.fn(async (credential: SavedCredential) => {
        vault.set(credential.id, credential);
        return credential;
      }),
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

const save = (password: string, displayName = "Dave") =>
  triggerPasswordManagerSeedSave({ password, displayName });

describe("password manager seed backup", () => {
  it("stores distinct accounts with the same display name separately", async () => {
    expect(await save(firstSeed)).toBe("saved");
    expect(await save(secondSeed)).toBe("saved");

    expect(vault.size).toBe(2);
    expect([...vault.values()].map(({ password }) => password)).toEqual([
      firstSeed,
      secondSeed,
    ]);
    const identity = await deriveNostrKeysFromSlip39(firstSeed);
    expect(identity).not.toBeNull();
    expect(vault.get(`linky.seed:${identity?.npub}`)?.password).toBe(firstSeed);
    for (const credential of vault.values()) {
      expect(credential.id).toMatch(/^linky\.seed:npub1[a-z0-9]+$/);
      expect(credential.name).toBe("Dave");
    }
  });

  it("keeps one account ID across renames and repeated backups", async () => {
    await save(firstSeed);
    const originalId = [...vault.keys()][0];
    await save(firstSeed, "Renamed profile");

    expect([...vault.keys()]).toEqual([originalId]);
    expect(vault.get(originalId ?? "")?.name).toBe("Renamed profile");
    expect(vault.get(originalId ?? "")?.password).toBe(firstSeed);
  });

  it("leaves legacy name-based credentials untouched", async () => {
    const legacy = { id: "Dave", name: "Dave", password: secondSeed };
    vault.set(legacy.id, legacy);
    await save(firstSeed);

    expect(vault.get("Dave")).toBe(legacy);
    expect(vault.size).toBe(2);
  });

  it("does not save an invalid seed under a name-based fallback", async () => {
    expect(await save("invalid seed")).toBe("failed");
    expect(vault.size).toBe(0);
  });
});
