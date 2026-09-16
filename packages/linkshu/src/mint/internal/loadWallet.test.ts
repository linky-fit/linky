import { deriveKeysetId, Mint, Wallet } from "@cashu/cashu-ts";
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
});
