import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testPlatformPorts } from "../testUtils/appRegistry";
import type { SecretRead } from "./ports";
import { loadSession, mirrorPushNsec } from "./session";

const mocks = vi.hoisted(() => ({
  reportAppLog: vi.fn(),
  setStoredPushNsec: vi.fn(() => Promise.resolve()),
  clearStoredPushNsec: vi.fn(() => Promise.resolve()),
}));
vi.mock("../devtools/inspector/appLog", () => ({
  reportAppLog: mocks.reportAppLog,
}));
vi.mock("../utils/pushNsecStorage", () => ({
  setStoredPushNsec: mocks.setStoredPushNsec,
  clearStoredPushNsec: mocks.clearStoredPushNsec,
}));

const NSEC = "linky.nostr_nsec";
const APP_MNEMONIC = "linky.initialMnemonic";
const CASHU_MNEMONIC = "linky.cashu_bip85_mnemonic";
const SLIP39 = "linky.nostr_slip39_seed";

const APP_MNEMONIC_STATE = "linky.app_mnemonic_state.v1";

/** Ports whose secure store answers from `secure` and whose localStorage holds `local`; pass a Map to share it across boots. */
const ports = (
  secure: Readonly<Record<string, SecretRead | Promise<SecretRead>>>,
  local: Readonly<Record<string, string>> | Map<string, string> = {},
) => {
  const items = local instanceof Map ? local : new Map(Object.entries(local));
  return testPlatformPorts({
    kv: {
      getItem: (key) => items.get(key) ?? null,
      setItem: (key, value) => void items.set(key, value),
      removeItem: (key) => void items.delete(key),
    },
    secrets: {
      read: (key) =>
        Promise.resolve(secure[key] ?? { _tag: "Missing" as const }),
    },
  });
};

const found = (value: string): SecretRead => ({ _tag: "Found", value });
const unavailable: SecretRead = { _tag: "Unavailable", cause: "bridge down" };

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("loadSession", () => {
  it("is signed out without an nsec anywhere", async () => {
    await expect(loadSession(ports({}))).resolves.toEqual({
      _tag: "SignedOut",
    });
  });

  it("prefers the secure store over a diverging localStorage copy", async () => {
    const session = await loadSession(
      ports(
        {
          [NSEC]: found("nsec1secure"),
          [APP_MNEMONIC]: found("app words"),
          [SLIP39]: found("slip39 words"),
        },
        { [NSEC]: "nsec1stale", [CASHU_MNEMONIC]: "cashu words" },
      ),
    );
    expect(session).toEqual({
      _tag: "SignedIn",
      degraded: false,
      secrets: {
        nsec: "nsec1secure",
        appMnemonic: "app words",
        cashuMnemonic: "cashu words",
        slip39Seed: "slip39 words",
      },
    });
    expect(mocks.reportAppLog).not.toHaveBeenCalled();
  });

  it("runs degraded on the localStorage copy when the secure store fails", async () => {
    const session = await loadSession(
      ports(
        { [NSEC]: unavailable, [APP_MNEMONIC]: unavailable },
        { [NSEC]: "nsec1local", [APP_MNEMONIC]: "app words" },
      ),
    );
    expect(session).toMatchObject({
      _tag: "SignedIn",
      degraded: true,
      secrets: { nsec: "nsec1local", appMnemonic: "app words" },
      unreadable: new Set(),
    });
    expect(mocks.reportAppLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tag: "session.secretsDegraded",
        payload: { keys: [NSEC, APP_MNEMONIC], unreadable: [] },
      }),
    );
    expect(JSON.stringify(mocks.reportAppLog.mock.calls)).not.toContain(
      "nsec1local",
    );
  });

  it("marks a failed secret without a localStorage copy unreadable, not missing", async () => {
    const session = await loadSession(
      ports(
        { [NSEC]: found("nsec1secure"), [CASHU_MNEMONIC]: unavailable },
        { [APP_MNEMONIC]: "app words" },
      ),
    );
    expect(session).toMatchObject({
      _tag: "SignedIn",
      degraded: true,
      secrets: { cashuMnemonic: null },
      unreadable: new Set(["cashuMnemonic"]),
    });
    expect(mocks.reportAppLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tag: "session.secretsDegraded",
        payload: { keys: [CASHU_MNEMONIC], unreadable: [CASHU_MNEMONIC] },
      }),
    );
  });

  it("reports the secrets unavailable when the secure store fails and nothing is stored locally", async () => {
    const session = await loadSession(ports({ [NSEC]: unavailable }));
    expect(session).toEqual({
      _tag: "SecretsUnavailable",
      cause: `${NSEC}: bridge down`,
    });
    expect(mocks.reportAppLog).toHaveBeenCalledWith(
      expect.objectContaining({ tag: "session.secretsUnavailable" }),
    );
  });

  it("stops waiting for a hung secure store after five seconds", async () => {
    vi.useFakeTimers();
    const loading = loadSession(
      ports({ [NSEC]: new Promise<SecretRead>(() => {}) }, { [NSEC]: "nsec1" }),
    );
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(loading).resolves.toMatchObject({
      _tag: "SignedIn",
      degraded: true,
      cause: `${NSEC}: timed out`,
    });
  });
});

describe("loadSession without a readable app mnemonic", () => {
  it("signs an nsec-only account in when its app mnemonic read fails", async () => {
    const local = new Map<string, string>();
    await loadSession(ports({ [NSEC]: found("nsec1secure") }, local));
    expect(local.get(APP_MNEMONIC_STATE)).toBe("absent");

    const session = await loadSession(
      ports(
        { [NSEC]: found("nsec1secure"), [APP_MNEMONIC]: unavailable },
        local,
      ),
    );
    expect(session).toMatchObject({
      _tag: "SignedIn",
      degraded: true,
      secrets: { nsec: "nsec1secure", appMnemonic: null },
      unreadable: new Set(),
    });
  });

  it("asks the user instead of opening the anonymous database after localStorage was evicted", async () => {
    const session = await loadSession(
      ports({ [NSEC]: found("nsec1secure"), [APP_MNEMONIC]: unavailable }),
    );
    expect(session).toEqual({
      _tag: "SecretsUnavailable",
      cause: `${APP_MNEMONIC}: bridge down`,
    });
    expect(mocks.reportAppLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tag: "session.appMnemonicUnreadable",
        payload: { keys: [APP_MNEMONIC], appMnemonicState: "unknown" },
      }),
    );
  });

  it("asks the user after an eviction and an nsec-only re-save", async () => {
    const local = new Map<string, string>();
    await loadSession(
      ports(
        { [NSEC]: found("nsec1secure"), [APP_MNEMONIC]: found("app words") },
        local,
      ),
    );
    // persistSyncedActiveNostrIdentity writes the nsec back, not the app mnemonic.
    local.set(NSEC, "nsec1secure");

    const session = await loadSession(
      ports(
        { [NSEC]: found("nsec1secure"), [APP_MNEMONIC]: unavailable },
        local,
      ),
    );
    expect(session).toMatchObject({ _tag: "SecretsUnavailable" });
    expect(mocks.reportAppLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tag: "session.appMnemonicUnreadable",
        payload: { keys: [APP_MNEMONIC], appMnemonicState: "present" },
      }),
    );
  });

  it("runs degraded on the localStorage copy of a failed app mnemonic, and records it present", async () => {
    const local = new Map([
      [APP_MNEMONIC, "app words"],
      [APP_MNEMONIC_STATE, "absent"],
    ]);
    const session = await loadSession(
      ports(
        { [NSEC]: found("nsec1secure"), [APP_MNEMONIC]: unavailable },
        local,
      ),
    );
    expect(session).toMatchObject({
      _tag: "SignedIn",
      degraded: true,
      secrets: { appMnemonic: "app words" },
      unreadable: new Set(),
    });
    expect(local.get(APP_MNEMONIC_STATE)).toBe("present");
  });

  it("keeps a recorded mnemonic present when the secure store reports it missing", async () => {
    const local = new Map([[APP_MNEMONIC_STATE, "present"]]);
    const session = await loadSession(
      ports({ [NSEC]: found("nsec1secure") }, local),
    );
    expect(session).toEqual({
      _tag: "SecretsUnavailable",
      cause: `${APP_MNEMONIC}: missing`,
    });
    expect(local.get(APP_MNEMONIC_STATE)).toBe("present");
  });

  it("leaves the marker alone while the read fails", async () => {
    const local = new Map<string, string>();
    await loadSession(
      ports(
        { [NSEC]: found("nsec1secure"), [APP_MNEMONIC]: unavailable },
        local,
      ),
    );
    expect(local.has(APP_MNEMONIC_STATE)).toBe(false);
  });
});

describe("mirrorPushNsec", () => {
  beforeEach(() => vi.clearAllMocks());

  it("mirrors a signed-in nsec and clears it once signed out", async () => {
    mirrorPushNsec({
      _tag: "SignedIn",
      degraded: false,
      secrets: {
        nsec: "nsec1",
        appMnemonic: null,
        cashuMnemonic: null,
        slip39Seed: null,
      },
    });
    mirrorPushNsec({ _tag: "SignedOut" });
    await vi.waitFor(() => {
      expect(mocks.setStoredPushNsec).toHaveBeenCalledWith("nsec1");
      expect(mocks.clearStoredPushNsec).toHaveBeenCalledTimes(1);
    });
  });

  it("leaves the mirror alone when the secrets could not be read", async () => {
    mirrorPushNsec({ _tag: "SecretsUnavailable", cause: "bridge down" });
    await Promise.resolve();
    expect(mocks.setStoredPushNsec).not.toHaveBeenCalled();
    expect(mocks.clearStoredPushNsec).not.toHaveBeenCalled();
  });
});
