import { DEFAULT_NOSTR_RELAYS } from "@linky-fit/linkstr";
import { SUPPORTER_ACCEPTED_MINTS } from "@linky-fit/supporter";
import { describe, expect, it } from "bun:test";
import { ConfigError, loadConfig, readRecoverySeed } from "./config";
import { createHttpHandler } from "./http";

describe("loadConfig", () => {
  it("defaults to the shared accepted mints and the default relays", () => {
    const config = loadConfig({});
    expect<ReadonlyArray<string>>(config.acceptedMints).toEqual(
      SUPPORTER_ACCEPTED_MINTS,
    );
    expect<ReadonlyArray<string>>(config.relays).toEqual(DEFAULT_NOSTR_RELAYS);
    expect(config.port).toBe(8788);
    expect(config.buildCommitSha).toBe("unknown");
    expect(config.allowInsecureLocalhostRelays).toBe(false);
  });

  it("reads the dev overrides", () => {
    const config = loadConfig({
      SUPPORTER_ACCEPTED_MINTS:
        "http://localhost:3338/, https://testnut.cashu.space",
      SUPPORTER_RELAYS: "ws://localhost:7777",
      SUPPORTER_ALLOW_INSECURE_LOCALHOST_RELAYS: "1",
      BUILD_COMMIT_SHA: "ABCDEF0123456789",
    });
    expect<ReadonlyArray<string>>(config.acceptedMints).toEqual([
      "http://localhost:3338",
      "https://testnut.cashu.space",
    ]);
    expect<ReadonlyArray<string>>(config.relays).toEqual([
      "ws://localhost:7777",
    ]);
    expect(config.allowInsecureLocalhostRelays).toBe(true);
    expect(config.buildCommitSha).toBe("abcdef012345");
  });

  it("rejects a relay that is neither wss nor loopback ws", () => {
    expect(() =>
      loadConfig({ SUPPORTER_RELAYS: "ws://nostr-relay:8080" }),
    ).toThrow(ConfigError);
  });

  it("requires the recovery seed", () => {
    expect(() => readRecoverySeed({})).toThrow(ConfigError);
  });
});

describe("http", () => {
  const handle = createHttpHandler("abcdef012345");

  it("answers the health check and the build commit", async () => {
    expect(await handle(new Request("http://supporter/health")).json()).toEqual(
      { ok: true },
    );
    expect(await handle(new Request("http://supporter/")).text()).toBe(
      "abcdef012345\n",
    );
    expect(handle(new Request("http://supporter/seed")).status).toBe(404);
  });
});
