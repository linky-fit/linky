import { HDKey } from "@scure/bip32";
import { NETWORK, p2tr } from "@scure/btc-signer";
import {
  bitcoinPaymentUri,
  canonicalBitcoinAddress,
  deriveDepositAddress,
  explorerAddressUrl,
  explorerTxUrl,
  isValidBitcoinAddress,
  parseDepositXpub,
  sameBitcoinAddress,
} from "./bitcoin";

// BIP86 test vectors: "abandon abandon ... about", account m/86'/0'/0'.
const BIP86_XPUB =
  "xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ";
const BIP86_ROOT_XPRV =
  "xprv9s21ZrQH143K3GJpoapnV8SFfukcVBSfeCficPSGfubmSFDxo1kuHnLisriDvSnRRuL2Qrg5ggqHKNVpxR86QEC8w35uxmGoggxtQTPvfUu";

const TEST_VERSIONS = { public: 0x043587cf, private: 0x04358394 };

/** The BIP86 account key re-encoded with test-network version bytes. */
const bip86Tpub = (() => {
  const key = HDKey.fromExtendedKey(BIP86_XPUB);
  return new HDKey({
    versions: TEST_VERSIONS,
    depth: key.depth,
    index: key.index,
    parentFingerprint: key.parentFingerprint,
    chainCode: key.chainCode ?? new Uint8Array(),
    publicKey: key.publicKey ?? new Uint8Array(),
  }).publicExtendedKey;
})();

describe("deriveDepositAddress", () => {
  it("matches the BIP86 receive addresses", () => {
    expect(
      deriveDepositAddress({ xpub: BIP86_XPUB, index: 0, network: "mainnet" }),
    ).toBe("bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr");
    expect(
      deriveDepositAddress({ xpub: BIP86_XPUB, index: 1, network: "mainnet" }),
    ).toBe("bc1p4qhjn9zdvkux4e44uhx8tc55attvtyu358kutcqkudyccelu0was9fqzwh");
  });

  it("builds the BIP86 change address with the same Taproot encoding", () => {
    const change = HDKey.fromExtendedKey(BIP86_XPUB)
      .deriveChild(1)
      .deriveChild(0).publicKey;
    expect(p2tr(change?.subarray(1) ?? "", undefined, NETWORK).address).toBe(
      "bc1p3qkhfews2uk44qtvauqyr2ttdsw7svhkl9nkm9s9c3x4ax5h60wqwruhk7",
    );
  });

  it("derives from a tpub with the network's address prefix", () => {
    const testnet = deriveDepositAddress({
      xpub: bip86Tpub,
      index: 0,
      network: "testnet",
    });
    const regtest = deriveDepositAddress({
      xpub: bip86Tpub,
      index: 0,
      network: "regtest",
    });
    expect(testnet).toMatch(/^tb1p/);
    expect(regtest).toMatch(/^bcrt1p/);
    expect(isValidBitcoinAddress(testnet, "signet")).toBe(true);
    expect(isValidBitcoinAddress(regtest, "regtest")).toBe(true);
  });

  it("throws for a key of the other network", () => {
    expect(() =>
      deriveDepositAddress({ xpub: bip86Tpub, index: 0, network: "mainnet" }),
    ).toThrow();
    expect(() =>
      deriveDepositAddress({ xpub: BIP86_XPUB, index: 0, network: "regtest" }),
    ).toThrow();
  });

  it("throws for a key that is no extended public key", () => {
    expect(() =>
      deriveDepositAddress({ xpub: "nope", index: 0, network: "mainnet" }),
    ).toThrow();
  });
});

describe("parseDepositXpub", () => {
  it("accepts an account xpub on mainnet and a tpub on the test networks", () => {
    expect(parseDepositXpub(` ${BIP86_XPUB}\n`, "mainnet")).toBe(BIP86_XPUB);
    expect(parseDepositXpub(bip86Tpub, "testnet")).toBe(bip86Tpub);
    expect(parseDepositXpub(bip86Tpub, "signet")).toBe(bip86Tpub);
    expect(parseDepositXpub(bip86Tpub, "regtest")).toBe(bip86Tpub);
  });

  it("takes the key out of a Taproot descriptor, as Trezor Suite shows one", () => {
    expect(
      parseDepositXpub(
        `tr([73c5da0a/86'/0'/0']${BIP86_XPUB}/<0;1>/*)#abcd1234`,
        "mainnet",
      ),
    ).toBe(BIP86_XPUB);
    expect(
      parseDepositXpub(`tr([73c5da0a/86h/0h/0h]${BIP86_XPUB}/0/*)`, "mainnet"),
    ).toBe(BIP86_XPUB);
    expect(parseDepositXpub(`tr(${BIP86_XPUB})`, "mainnet")).toBe(BIP86_XPUB);
    expect(
      parseDepositXpub(
        `tr([73c5da0a/86'/1'/0']${bip86Tpub}/<0;1>/*)`,
        "regtest",
      ),
    ).toBe(bip86Tpub);
  });

  it("rejects descriptors of another type or coin", () => {
    expect(
      parseDepositXpub(
        `wpkh([73c5da0a/84'/0'/0']${BIP86_XPUB}/<0;1>/*)`,
        "mainnet",
      ),
    ).toBeNull();
    expect(
      parseDepositXpub(
        `tr([73c5da0a/86'/1'/0']${BIP86_XPUB}/<0;1>/*)`,
        "mainnet",
      ),
    ).toBeNull();
  });

  it("rejects a key for the other network", () => {
    expect(parseDepositXpub(BIP86_XPUB, "regtest")).toBeNull();
    expect(parseDepositXpub(bip86Tpub, "mainnet")).toBeNull();
  });

  it("rejects private keys, other depths and garbage", () => {
    expect(parseDepositXpub(BIP86_ROOT_XPRV, "mainnet")).toBeNull();
    const root = HDKey.fromExtendedKey(BIP86_ROOT_XPRV);
    expect(parseDepositXpub(root.publicExtendedKey, "mainnet")).toBeNull();
    expect(
      parseDepositXpub(
        root.derive("m/86'/0'/0'").privateExtendedKey,
        "mainnet",
      ),
    ).toBeNull();
    expect(
      parseDepositXpub(`${BIP86_XPUB.slice(0, -1)}R`, "mainnet"),
    ).toBeNull();
    expect(parseDepositXpub("", "mainnet")).toBeNull();
  });

  it("matches the vector's account key derived from the root", () => {
    const root = HDKey.fromExtendedKey(BIP86_ROOT_XPRV);
    expect(root.derive("m/86'/0'/0'").publicExtendedKey).toBe(BIP86_XPUB);
  });
});

describe("isValidBitcoinAddress", () => {
  const mainnet = {
    p2pkh: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
    p2sh: "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy",
    p2wpkh: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
    p2wsh: "bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3",
    p2tr: "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr",
  };
  const testnet = {
    p2pkh: "mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn",
    p2sh: "2MzQwSSnBHWHqSAqtTVQ6v47XtaisrJa1Vc",
    p2wpkh: "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
    p2wsh: "tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7",
    p2tr: deriveDepositAddress({
      xpub: bip86Tpub,
      index: 0,
      network: "testnet",
    }),
  };
  const regtest = {
    p2wpkh: "bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080",
    p2tr: deriveDepositAddress({
      xpub: bip86Tpub,
      index: 0,
      network: "regtest",
    }),
  };

  it.each(Object.entries(mainnet))("accepts mainnet %s", (_, address) => {
    expect(isValidBitcoinAddress(address, "mainnet")).toBe(true);
    expect(isValidBitcoinAddress(address, "testnet")).toBe(false);
    expect(isValidBitcoinAddress(address, "regtest")).toBe(false);
  });

  it.each(Object.entries(testnet))(
    "accepts testnet and signet %s",
    (_, address) => {
      expect(isValidBitcoinAddress(address, "testnet")).toBe(true);
      expect(isValidBitcoinAddress(address, "signet")).toBe(true);
      expect(isValidBitcoinAddress(address, "mainnet")).toBe(false);
    },
  );

  it("accepts regtest bech32 and the test networks' base58 on regtest", () => {
    expect(isValidBitcoinAddress(regtest.p2wpkh, "regtest")).toBe(true);
    expect(isValidBitcoinAddress(regtest.p2tr, "regtest")).toBe(true);
    expect(isValidBitcoinAddress(testnet.p2pkh, "regtest")).toBe(true);
    expect(isValidBitcoinAddress(testnet.p2sh, "regtest")).toBe(true);
    expect(isValidBitcoinAddress(testnet.p2wpkh, "regtest")).toBe(false);
    expect(isValidBitcoinAddress(regtest.p2wpkh, "testnet")).toBe(false);
    expect(isValidBitcoinAddress(regtest.p2wpkh, "mainnet")).toBe(false);
  });

  it("accepts an all-uppercase bech32 address", () => {
    expect(isValidBitcoinAddress(mainnet.p2wpkh.toUpperCase(), "mainnet")).toBe(
      true,
    );
  });

  it.each([
    ["a broken checksum", "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5"],
    ["a future witness version", "bc1zw508d6qejxtdg4y5r3zarvaryvaxxpcs"],
    ["text", "hello"],
    ["nothing", ""],
  ])("rejects %s", (_, address) => {
    expect(isValidBitcoinAddress(address, "mainnet")).toBe(false);
  });
});

describe("canonicalBitcoinAddress", () => {
  const p2tr = "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr";

  it("lowercases an uppercase bech32 address", () => {
    expect(canonicalBitcoinAddress(p2tr.toUpperCase(), "mainnet")).toBe(p2tr);
    expect(
      canonicalBitcoinAddress(
        "BCRT1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KYGT080",
        "regtest",
      ),
    ).toBe("bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080");
  });

  it("keeps base58 as written and rejects what does not validate", () => {
    const p2pkh = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";
    expect(canonicalBitcoinAddress(p2pkh, "mainnet")).toBe(p2pkh);
    expect(canonicalBitcoinAddress(p2pkh.toLowerCase(), "mainnet")).toBeNull();
    expect(canonicalBitcoinAddress(p2tr, "testnet")).toBeNull();
  });
});

describe("sameBitcoinAddress", () => {
  it("ignores the case of bech32 only", () => {
    expect(sameBitcoinAddress("BC1QABC", "bc1qabc")).toBe(true);
    expect(sameBitcoinAddress("TB1QABC", "tb1qabc")).toBe(true);
    expect(sameBitcoinAddress("bcrt1qabc", "BCRT1QABC")).toBe(true);
    expect(sameBitcoinAddress("1AbC", "1abc")).toBe(false);
    expect(sameBitcoinAddress("bc1qabc", "bc1qabd")).toBe(false);
  });
});

describe("bitcoinPaymentUri", () => {
  it.each([
    [100_000, "0.001"],
    [123, "0.00000123"],
    [1, "0.00000001"],
    [250_000, "0.0025"],
    [100_000_000, "1"],
    [150_000_000, "1.5"],
    [2_100_000_000_000_000, "21000000"],
  ])("writes %i sat as %s BTC", (sat, btc) => {
    expect(bitcoinPaymentUri("bc1qexample", sat)).toBe(
      `bitcoin:bc1qexample?amount=${btc}`,
    );
  });
});

describe("explorer urls", () => {
  it("joins the explorer root with or without a trailing slash", () => {
    expect(explorerTxUrl("https://mempool.space/", "ab")).toBe(
      "https://mempool.space/tx/ab",
    );
    expect(explorerAddressUrl("https://mempool.space", "bc1q")).toBe(
      "https://mempool.space/address/bc1q",
    );
  });
});
