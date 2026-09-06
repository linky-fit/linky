import { Mint, Wallet, getEncodedToken } from "@cashu/cashu-ts";
import type { Proof } from "@cashu/cashu-ts";
import { Effect, Layer } from "effect";
import {
  Bip39Seed,
  Bolt11Invoice,
  KeyValueStore,
  makeInMemoryKeyValueStore,
  makeInMemoryTokenStore,
  MintUrl,
  parseTokenText,
  Receive,
  ReceiveDraft,
  runLinkshu,
  TokenStore,
} from "../../src";
import type { StoredTokenRow } from "../../src";

/**
 * The dev-stack Nutshell FakeWallet mint (docker-compose.dev.yml
 * `cashu-mint`). It auto-settles every bolt11 invoice it issues and can "pay"
 * any invoice with fake sats, so a mint quote's `request` doubles as a
 * payable invoice.
 */
export const mintUrl = MintUrl.make(
  process.env.LINKSHU_MINT_URL ?? "http://localhost:3338",
);

export const targetMintUrl = MintUrl.make(
  process.env.LINKSHU_TARGET_MINT_URL ?? "http://localhost:3339",
);

/** The local mint charges input_fee_ppk=100 on purpose (see CLAUDE.md). */
export const INPUT_FEE_PPK = 100;
export const inputFee = (proofCount: number): number =>
  Math.ceil((proofCount * INPUT_FEE_PPK) / 1000);

/**
 * Fresh seed per run: deterministic counters live at the mint, so a reused
 * seed would start every run inside an already-signed counter range.
 */
export const randomSeed = (): Bip39Seed =>
  Bip39Seed.make(crypto.getRandomValues(new Uint8Array(64)));

/** A plain cashu-ts wallet at the mint, outside linkshu. */
export const loadMintWallet = async (mint = mintUrl): Promise<Wallet> => {
  const wallet = new Wallet(new Mint(mint), { unit: "sat" });
  await wallet.loadMint();
  return wallet;
};

/** Mints fresh sats via a bolt11 quote the FakeWallet backend auto-settles. */
export const fundProofs = async (amountSat: number): Promise<Proof[]> => {
  const wallet = await loadMintWallet();
  const quote = await wallet.createMintQuoteBolt11(amountSat);
  return wallet.mintProofsBolt11(amountSat, quote, undefined, {
    type: "random",
  });
};

export const tokenOf = (proofs: Proof[]): string =>
  getEncodedToken({ mint: mintUrl, unit: "sat", proofs });

export const fundToken = async (amountSat: number): Promise<string> =>
  tokenOf(await fundProofs(amountSat));

/** A different mint's invoice avoids Nutshell's internal self-payment path. */
export const invoiceFor = async (amountSat: number): Promise<Bolt11Invoice> => {
  const wallet = await loadMintWallet(targetMintUrl);
  const quote = await wallet.createMintQuoteBolt11(amountSat);
  return Bolt11Invoice.make(quote.request);
};

/** Somebody else claims the token: its proofs are spent at the mint. */
export const claimExternally = async (tokenText: string): Promise<void> => {
  const wallet = await loadMintWallet();
  await wallet.receive(tokenText, undefined, { type: "random" });
};

export const acceptedTotalOf = (rows: ReadonlyArray<StoredTokenRow>): number =>
  rows
    .filter((row) => row.state === "accepted")
    .reduce(
      (sum, row) => sum + (parseTokenText(row.tokenText)?.amount ?? 0),
      0,
    );

/**
 * Storage that outlives the runtime using it. Two `runLinkshu` calls over one
 * of these are a process restart: nothing survives in memory, everything
 * survives in the ports.
 */
export const durableStorage = () => {
  const kv = makeInMemoryKeyValueStore();
  const tokens = makeInMemoryTokenStore();
  return {
    kv,
    tokens,
    layers: {
      keyValueStore: Layer.succeed(KeyValueStore, kv),
      tokenStore: Layer.succeed(TokenStore, tokens),
    },
  };
};

/** One runtime with in-memory ports: receive `text`, report the receipt and rows. */
export const receiveOnce = (seed: Bip39Seed, text: string) =>
  runLinkshu(
    { bip39Seed: seed },
    Effect.gen(function* () {
      const receive = yield* Receive;
      const receipt = yield* receive.receive(new ReceiveDraft({ text }));
      const rows = yield* (yield* TokenStore).loadAll;
      return { receipt, rows };
    }),
  );
