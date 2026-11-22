import {
  deriveKeysetId,
  Mint,
  MintOperationError,
  RateLimitError,
  Wallet,
} from "@cashu/cashu-ts";
import type { GetInfoResponse, MintKeys, MintKeyset } from "@cashu/cashu-ts";
import { loadWallet } from "./loadWallet";

const mintUrl = "https://mint.example";
const keys = {
  "1": "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
};
const otherKeys = {
  "1": "02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5",
};
const info: GetInfoResponse = {
  name: "Test mint",
  pubkey: keys["1"],
  version: "test",
  contact: [],
  nuts: {
    "4": { methods: [], disabled: false },
    "5": { methods: [], disabled: false },
  },
};

const keyset = (versionByte: number): MintKeyset => ({
  id: deriveKeysetId(keys, { versionByte }),
  active: true,
  unit: "sat",
  input_fee_ppk: 0,
});

const serveMint = (metadata: MintKeyset[], servedKeys: MintKeys[]) => {
  vi.spyOn(Mint.prototype, "getInfo").mockResolvedValue(info);
  vi.spyOn(Mint.prototype, "getKeySets").mockResolvedValue({
    keysets: metadata,
  });
  return vi.spyOn(Mint.prototype, "getKeys").mockResolvedValue({
    keysets: servedKeys,
  });
};

const load = () => loadWallet({ Mint, Wallet, mintUrl, unit: " sat " });

afterEach(() => vi.restoreAllMocks());

describe("loadWallet", () => {
  it.each([0, 1])("loads verified version %i mint keys", async (version) => {
    const metadata = keyset(version);
    serveMint([metadata], [{ ...metadata, keys }]);

    const wallet = await load();

    expect(wallet.keysetId).toBe(metadata.id);
    expect(wallet.unit).toBe("sat");
    expect(wallet.getKeyset().keys).toEqual(keys);
    expect(wallet.getMintInfo().name).toBe(info.name);
  });

  it.each([0, 1])("cannot use substituted version %i keys", async (version) => {
    const metadata = keyset(version);
    serveMint([metadata], [{ ...metadata, keys: otherKeys }]);
    const primeFromCache = vi.spyOn(Wallet.prototype, "loadMintFromCache");

    const wallet = await load();
    expect(() => wallet.getKeyset()).toThrow();
    await expect(wallet.keyChain.ensureKeysetKeys(metadata.id)).rejects.toThrow(
      "Keyset verification failed",
    );
    expect(wallet.keyChain.getKeyset(metadata.id).hasKeys).toBe(false);
    expect(primeFromCache).not.toHaveBeenCalled();
  });

  it.each([
    "Couldn't verify keyset ID 01884a74bb2fc5ee",
    "A short keyset ID v2 was encountered, but got no keysets to map it to.",
    "Couldn't map short keyset ID 00ff to any known keysets of the current Mint",
    "Keyset verification failed for ID 00ff",
    "fetch failed",
  ])("propagates %s without a cache fallback", async (message) => {
    const error = new Error(message);
    vi.spyOn(Wallet.prototype, "loadMint").mockRejectedValue(error);
    const primeFromCache = vi.spyOn(Wallet.prototype, "loadMintFromCache");
    const mintInfo = vi
      .spyOn(Mint.prototype, "getInfo")
      .mockRejectedValue(new Error("must not fetch fallback data"));

    await expect(load()).rejects.toBe(error);
    expect(primeFromCache).not.toHaveBeenCalled();
    expect(mintInfo).not.toHaveBeenCalled();
  });

  it("preserves restore access when the mint has only inactive keysets", async () => {
    const inactive = { ...keyset(0), active: false };
    const getKeys = serveMint([inactive], []);
    const wallet = await load();
    getKeys.mockResolvedValue({ keysets: [{ ...inactive, keys }] });

    const restored = await wallet.keyChain.ensureKeysetKeys(inactive.id);
    expect(restored.verify()).toBe(true);
    expect(restored.keys).toEqual(keys);
  });

  it("verifies inactive keysets when loading their keys for old proofs", async () => {
    const active = keyset(1);
    const inactive = { ...keyset(0), active: false };
    const getKeys = serveMint([active, inactive], [{ ...active, keys }]);
    const wallet = await load();
    getKeys.mockResolvedValue({ keysets: [{ ...inactive, keys: otherKeys }] });

    await expect(wallet.keyChain.ensureKeysetKeys(inactive.id)).rejects.toThrow(
      "Keyset verification failed",
    );
    expect(wallet.keyChain.getKeyset(inactive.id).hasKeys).toBe(false);

    getKeys.mockResolvedValue({ keysets: [{ ...inactive, keys }] });
    const restored = await wallet.keyChain.ensureKeysetKeys(inactive.id);
    expect(restored.keys).toEqual(keys);
    expect(restored.verify()).toBe(true);
  });

  it("aborts in-flight HTTP requests when the loader deadline expires", async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      "fetch",
      (_input: Parameters<typeof fetch>[0], init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          const signal = init?.signal;
          if (signal) {
            signals.push(signal);
            signal.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          }
        }),
    );
    try {
      await expect(
        loadWallet({ Mint, Wallet, mintUrl, unit: "sat", timeoutMs: 15 }),
      ).rejects.toThrow(/timed out/i);
      expect(signals.length).toBeGreaterThan(0);
      expect(signals.every((signal) => signal.aborted)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("restores the mint's default methods after load completes", async () => {
    const metadata = keyset(1);
    serveMint([metadata], [{ ...metadata, keys }]);

    const wallet = await load();

    expect(Object.hasOwn(wallet.mint, "getInfo")).toBe(false);
    expect(Object.hasOwn(wallet.mint, "getKeySets")).toBe(false);
    expect(Object.hasOwn(wallet.mint, "getKeys")).toBe(false);
  });

  it("aborts sibling HTTP requests when one load request fails early", async () => {
    const siblingSignals: AbortSignal[] = [];
    vi.stubGlobal(
      "fetch",
      (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.endsWith("/v1/info")) {
          return Promise.resolve(new Response("boom", { status: 500 }));
        }
        return new Promise<Response>((_, reject) => {
          const signal = init?.signal;
          if (signal) {
            siblingSignals.push(signal);
            signal.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          }
        });
      },
    );
    try {
      await expect(load()).rejects.toThrow();
      expect(siblingSignals.length).toBeGreaterThan(0);
      expect(siblingSignals.every((signal) => signal.aborted)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("preserves MintOperationError codes from HTTP 400 responses", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        new Response(
          JSON.stringify({ code: 10000, detail: "mint rejected request" }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    try {
      const error = await load().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(MintOperationError);
      expect(error).toMatchObject({
        code: 10000,
        message: "mint rejected request",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("preserves RateLimitError and Retry-After from HTTP 429 responses", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        new Response("slow down", {
          status: 429,
          headers: { "Retry-After": "30" },
        }),
      ),
    );
    try {
      const error = await load().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(RateLimitError);
      expect(error).toMatchObject({ retryAfterMs: 30_000 });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("preserves large integers via cashu-ts JSONInt parsing", async () => {
    const metadata = keyset(1);
    const infoJson = JSON.stringify({
      ...info,
      nuts: {
        "4": {
          methods: [{ method: "bolt11", unit: "sat", max_amount: "__MAX__" }],
          disabled: false,
        },
        "5": { methods: [], disabled: false },
      },
    }).replace('"__MAX__"', "9007199254740993");
    const responses: Record<string, string> = {
      "/v1/info": infoJson,
      "/v1/keysets": JSON.stringify({ keysets: [metadata] }),
      "/v1/keys": JSON.stringify({ keysets: [{ ...metadata, keys }] }),
    };
    vi.stubGlobal("fetch", (input: Parameters<typeof fetch>[0]) => {
      const url = input instanceof Request ? input.url : String(input);
      const body = responses[new URL(url).pathname];
      return Promise.resolve(
        new Response(body ?? "null", {
          status: body === undefined ? 404 : 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });
    try {
      const wallet = await load();
      const nut4 = wallet.getMintInfo().cache.nuts["4"];
      expect(nut4?.methods[0]?.max_amount).toBe(9007199254740993n);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
