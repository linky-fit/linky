import { HDKey, type Versions } from "@scure/bip32";
import { Address, NETWORK, p2tr, TEST_NETWORK } from "@scure/btc-signer";
import type { BitcoinNetwork } from "./constants";

type AddressNetwork = typeof NETWORK;

const ADDRESS_NETWORKS: Record<BitcoinNetwork, AddressNetwork> = {
  mainnet: NETWORK,
  testnet: TEST_NETWORK,
  signet: TEST_NETWORK,
  regtest: { ...TEST_NETWORK, bech32: "bcrt" },
};

const MAINNET_VERSIONS: Versions = { public: 0x0488b21e, private: 0x0488ade4 };
const TEST_VERSIONS: Versions = { public: 0x043587cf, private: 0x04358394 };

const versionsFor = (network: BitcoinNetwork): Versions =>
  network === "mainnet" ? MAINNET_VERSIONS : TEST_VERSIONS;

/** BIP86 account keys sit at `m/86'/coin'/account'`. */
const ACCOUNT_DEPTH = 3;

// `tr([fingerprint/86'/coin'/account']xpub…/<0;1>/*)#checksum`, as wallets such as Trezor Suite show a Taproot account.
const TAPROOT_DESCRIPTOR =
  /^tr\((?:\[[0-9a-f]{8}\/86['h]\/(\d+)['h]\/\d+['h]\])?(\w+)(?:\/(?:<0;1>|0)\/\*)?\)(?:#\w{8})?$/iu;

/** The key a pasted xpub or Taproot descriptor names; `null` for a descriptor of another coin type. */
const keyOf = (text: string, network: BitcoinNetwork): string | null => {
  const descriptor = TAPROOT_DESCRIPTOR.exec(text);
  if (descriptor === null) return text;
  const [, coinType, key] = descriptor;
  const expectedCoinType = network === "mainnet" ? "0" : "1";
  return coinType === undefined || coinType === expectedCoinType
    ? (key ?? null)
    : null;
};

/**
 * The account-level extended public key `text` holds, bare or inside a
 * Taproot descriptor, when it is the network's: `xpub` on mainnet, `tpub` on
 * the test networks. Null for private keys, other depths, descriptors of
 * another type or coin, and anything that does not decode.
 */
export const parseDepositXpub = (
  text: string,
  network: BitcoinNetwork,
): string | null => {
  const xpub = keyOf(text.trim(), network);
  if (xpub === null) return null;
  try {
    const key = HDKey.fromExtendedKey(xpub, versionsFor(network));
    return key.privateKey === null && key.depth === ACCOUNT_DEPTH ? xpub : null;
  } catch {
    return null;
  }
};

/**
 * The BIP86 key-path Taproot address at receive index `index` (`0/index`
 * below the account key). Throws for a key that is not the network's (`xpub`
 * on mainnet, `tpub` elsewhere); validate it with `parseDepositXpub` first.
 */
export const deriveDepositAddress = (args: {
  readonly xpub: string;
  readonly index: number;
  readonly network: BitcoinNetwork;
}): string => {
  const publicKey = HDKey.fromExtendedKey(args.xpub, versionsFor(args.network))
    .deriveChild(0)
    .deriveChild(args.index).publicKey;
  if (publicKey === null) throw new Error("The extended key has no public key");
  const address = p2tr(
    publicKey.subarray(1),
    undefined,
    ADDRESS_NETWORKS[args.network],
  ).address;
  if (address === undefined) throw new Error("No Taproot address");
  return address;
};

const PAYABLE_TYPES = new Set(["pkh", "sh", "wpkh", "wsh", "tr"]);

/**
 * `address` in the form Esplora reports it, lowercase for bech32, when it is
 * a P2PKH, P2SH, P2WPKH, P2WSH or P2TR address on `network`; `null` otherwise.
 */
export const canonicalBitcoinAddress = (
  address: string,
  network: BitcoinNetwork,
): string | null => {
  const coder = Address(ADDRESS_NETWORKS[network]);
  try {
    const script = coder.decode(address);
    return script !== undefined && PAYABLE_TYPES.has(script.type)
      ? coder.encode(script)
      : null;
  } catch {
    return null;
  }
};

/** Whether `address` is a P2PKH, P2SH, P2WPKH, P2WSH or P2TR address on `network`. */
export const isValidBitcoinAddress = (
  address: string,
  network: BitcoinNetwork,
): boolean => canonicalBitcoinAddress(address, network) !== null;

const BECH32_ADDRESS = /^(bc|tb|bcrt)1/iu;

/** Whether two addresses are the same, ignoring the case of a bech32 one; base58 is case-sensitive. */
export const sameBitcoinAddress = (a: string, b: string): boolean =>
  a === b || (BECH32_ADDRESS.test(a) && a.toLowerCase() === b.toLowerCase());

const SATS_PER_BTC = 100_000_000;

/** Sats as a BTC decimal without trailing zeros: 100000 is `0.001`. */
const btcDecimal = (amountSat: number): string => {
  const whole = Math.floor(amountSat / SATS_PER_BTC);
  const fraction = String(amountSat % SATS_PER_BTC)
    .padStart(8, "0")
    .replace(/0+$/, "");
  return fraction === "" ? String(whole) : `${whole}.${fraction}`;
};

/** A BIP21 URI asking a wallet to pay `amountSat` to `address`. */
export const bitcoinPaymentUri = (address: string, amountSat: number): string =>
  `bitcoin:${address}?amount=${btcDecimal(amountSat)}`;

const explorerRoot = (explorerUrl: string): string =>
  explorerUrl.replace(/\/+$/, "");

export const explorerTxUrl = (explorerUrl: string, txid: string): string =>
  `${explorerRoot(explorerUrl)}/tx/${txid}`;

export const explorerAddressUrl = (
  explorerUrl: string,
  address: string,
): string => `${explorerRoot(explorerUrl)}/address/${address}`;
