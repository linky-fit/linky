import { afterEach, describe, expect, it, vi } from "vitest";
import { testPlatformPorts } from "../testUtils/appRegistry";
import { makeNativeSecretsPort } from "./secureStoreSecrets";
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
