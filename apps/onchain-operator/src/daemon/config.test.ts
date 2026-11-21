import { encodeNpub } from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { describe, expect, it } from "vitest";
import { loadDaemonConfig } from "./config";

const SAMPLE_SEED =
  "hand pregnant academic academic curious twin literary criminal teaspoon academic lying empty pipeline infant axle failure repair exotic frequent march";

describe("loadDaemonConfig", () => {
  it("loads defaults from OPERATOR_RECOVERY_SEED", () => {
    const config = loadDaemonConfig({ OPERATOR_RECOVERY_SEED: SAMPLE_SEED });
    expect(config.recoverySeed).toBe(SAMPLE_SEED);
    expect(config.dataDir).toBe("./data");
    expect(config.extraWatchers).toEqual([]);
    expect(config.appConfig.network).toBe("mainnet");
    expect(config.appConfig.mintUrl).toBe("https://cashu.cz");
    expect(config.appConfig.esploraUrl).toBe("https://mempool.space/api");
    expect(config.appConfig.explorerUrl).toBe("https://mempool.space");
    expect(config.appConfig.allowInsecureLocalhostRelays).toBe(false);
    expect(config.appConfig.nostrRelays.length).toBeGreaterThan(0);
    expect(config.appConfig.evoluRelayDefaults).toEqual([]);
  });

  it("reads the recovery seed from OPERATOR_RECOVERY_SEED_FILE", () => {
    const config = loadDaemonConfig(
      { OPERATOR_RECOVERY_SEED_FILE: "/run/secrets/seed" },
      (filePath) => {
        expect(filePath).toBe("/run/secrets/seed");
        return `  ${SAMPLE_SEED}\n`;
      },
    );
    expect(config.recoverySeed).toBe(SAMPLE_SEED);
  });

  it("rejects missing, empty, or conflicting recovery seed inputs", () => {
    expect(() => loadDaemonConfig({})).toThrow(/OPERATOR_RECOVERY_SEED/u);
    expect(() =>
      loadDaemonConfig({
        OPERATOR_RECOVERY_SEED: SAMPLE_SEED,
        OPERATOR_RECOVERY_SEED_FILE: "/run/secrets/seed",
      }),
    ).toThrow(/not both/u);
    expect(() =>
      loadDaemonConfig(
        { OPERATOR_RECOVERY_SEED_FILE: "/run/secrets/seed" },
        () => "   \n",
      ),
    ).toThrow(/empty/u);
  });

  it("parses OPERATOR_WATCHERS and overrides", () => {
    const first = makeIdentity().pubkey;
    const second = makeIdentity().pubkey;
    const config = loadDaemonConfig({
      OPERATOR_RECOVERY_SEED: SAMPLE_SEED,
      OPERATOR_WATCHERS: `${encodeNpub(first)}, ${encodeNpub(second)}`,
      OPERATOR_DATA_DIR: "/data",
      OPERATOR_NETWORK: "regtest",
      OPERATOR_MINT_URL: "http://localhost:3338",
      OPERATOR_ESPLORA_URL: "http://localhost:3002",
      OPERATOR_EXPLORER_URL: "http://localhost:3003",
      OPERATOR_NOSTR_RELAYS: "ws://localhost:7777",
      OPERATOR_EVOLU_RELAYS: "ws://localhost:4000",
      OPERATOR_ALLOW_INSECURE_LOCALHOST_RELAYS: "true",
    });
    expect(config.extraWatchers).toEqual([first, second]);
    expect(config.dataDir).toBe("/data");
    expect(config.appConfig.network).toBe("regtest");
    expect(config.appConfig.mintUrl).toBe("http://localhost:3338");
    expect(config.appConfig.esploraUrl).toBe("http://localhost:3002");
    expect(config.appConfig.explorerUrl).toBe("http://localhost:3003");
    expect(config.appConfig.nostrRelays).toEqual(["ws://localhost:7777"]);
    expect(config.appConfig.evoluRelayDefaults).toEqual([
      "ws://localhost:4000",
    ]);
    expect(config.appConfig.allowInsecureLocalhostRelays).toBe(true);
  });

  it("rejects invalid watchers, relays, and networks", () => {
    expect(() =>
      loadDaemonConfig({
        OPERATOR_RECOVERY_SEED: SAMPLE_SEED,
        OPERATOR_WATCHERS: "not-an-npub",
      }),
    ).toThrow(/OPERATOR_WATCHERS/u);
    expect(() =>
      loadDaemonConfig({
        OPERATOR_RECOVERY_SEED: SAMPLE_SEED,
        OPERATOR_NOSTR_RELAYS: "https://not-a-ws-relay",
      }),
    ).toThrow(/OPERATOR_NOSTR_RELAYS/u);
    expect(() =>
      loadDaemonConfig({
        OPERATOR_RECOVERY_SEED: SAMPLE_SEED,
        OPERATOR_EVOLU_RELAYS: "https://not-a-ws-relay",
      }),
    ).toThrow(/OPERATOR_EVOLU_RELAYS/u);
    expect(() =>
      loadDaemonConfig({
        OPERATOR_RECOVERY_SEED: SAMPLE_SEED,
        OPERATOR_NETWORK: "devnet",
      }),
    ).toThrow(/OPERATOR_NETWORK/u);
  });
});
