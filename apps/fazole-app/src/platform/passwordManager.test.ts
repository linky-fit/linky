import { afterEach, describe, expect, it, vi } from "vitest";
import { saveRecoverySeedToPasswordManager } from "./passwordManager";

const account = { recoverySeed: "twenty words", npub: "npub1shop" };

class FakePasswordCredential {
  readonly data: unknown;
  constructor(data: unknown) {
    this.data = data;
  }
}

const withBrowser = (store: (credential: unknown) => Promise<void>) => {
  vi.stubGlobal("PasswordCredential", FakePasswordCredential);
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("navigator", { credentials: { store } });
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("saveRecoverySeedToPasswordManager", () => {
  it("stores the seed as a password credential under the shop's name", async () => {
    const stored: FakePasswordCredential[] = [];
    withBrowser(async (credential) => {
      if (credential instanceof FakePasswordCredential) stored.push(credential);
    });
    expect(await saveRecoverySeedToPasswordManager(account, "Kavárna")).toBe(
      "saved",
    );
    expect(stored).toEqual([
      new FakePasswordCredential({
        id: "fazole.fit:npub1shop",
        name: "Kavárna",
        password: "twenty words",
      }),
    ]);
  });

  it("reports browsers without PasswordCredential as unsupported", async () => {
    vi.stubGlobal("PasswordCredential", undefined);
    expect(await saveRecoverySeedToPasswordManager(account, "Kavárna")).toBe(
      "unsupported",
    );
  });

  it("reports a rejected store as failed", async () => {
    withBrowser(() => Promise.reject(new Error("dismissed")));
    expect(await saveRecoverySeedToPasswordManager(account, "Kavárna")).toBe(
      "failed",
    );
  });
});
