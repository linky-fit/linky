import {
  Amount as CashuAmount,
  getEncodedToken,
  Mint,
  Wallet,
} from "@cashu/cashu-ts";
import type { Proof } from "@cashu/cashu-ts";
import { Effect, Layer } from "effect";
import {
  Bip39Seed,
  Bolt11Invoice,
  CurrencyUnit,
  KeyValueStore,
  makeInMemoryKeyValueStore,
  makeInMemoryOperationStore,
  makeInMemoryProofStore,
  MintUrl,
  OperationStore,
  ProofStore,
  Receive,
  ReceiveDraft,
  runLinkshu,
} from "../../src";
import type {
  NewProof,
  OperationKind,
  OperationStoreService,
  StoredOperation,
  StoredProof,
} from "../../src";
import { toNewProofs } from "../../src/internal/proofs";

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

export const tokenOf = (proofs: Proof[], mint: MintUrl = mintUrl): string =>
  getEncodedToken({ mint, unit: "sat", proofs });

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

/** The spendable balance the inventory holds. */
export const availableTotalOf = (proofs: ReadonlyArray<StoredProof>): number =>
  proofs
    .filter((proof) => proof.state === "available")
    .reduce((sum, proof) => sum + proof.amount, 0);

/** Stored proofs as cashu-ts proofs, for talking to a mint outside linkshu. */
export const toCashuProofs = (proofs: ReadonlyArray<StoredProof>): Proof[] =>
  proofs.map((proof) => ({
    id: proof.keysetId,
    amount: CashuAmount.from(proof.amount),
    secret: proof.secret,
    C: proof.C,
  }));

/**
 * Inventory rows for proofs minted outside linkshu, as a balance synced from
 * another device would land: `available`, owned by no operation.
 */
export const availableRowsOf = (proofs: Proof[]): ReadonlyArray<NewProof> => {
  const rows = toNewProofs(
    proofs,
    mintUrl,
    CurrencyUnit.make("sat"),
    "available",
    null,
  );
  if (rows === null) throw new Error("malformed mint proofs");
  return rows;
};

/** Operations of `kind` a resumer would still pick up. */
export const pendingOperations = (
  store: OperationStoreService,
  kind: OperationKind,
): Promise<ReadonlyArray<StoredOperation>> =>
  Effect.runPromise(
    Effect.map(store.loadAll, (operations) =>
      operations.filter(
        (operation) =>
          operation.kind === kind && operation.status === "pending",
      ),
    ),
  );

/**
 * Storage that outlives the runtime using it. Two `runLinkshu` calls over one
 * of these are a process restart: nothing survives in memory, everything
 * survives in the ports.
 */
export const durableStorage = () => {
  const kv = makeInMemoryKeyValueStore();
  const proofs = makeInMemoryProofStore();
  const operations = makeInMemoryOperationStore();
  return {
    kv,
    proofs,
    operations,
    layers: {
      keyValueStore: Layer.succeed(KeyValueStore, kv),
      proofStore: Layer.succeed(ProofStore, proofs),
      operationStore: Layer.succeed(OperationStore, operations),
    },
  };
};

/** One runtime with in-memory ports: receive `text`, report the receipt and inventory. */
export const receiveOnce = (seed: Bip39Seed, text: string) =>
  runLinkshu(
    { bip39Seed: seed },
    Effect.gen(function* () {
      const receive = yield* Receive;
      const receipt = yield* receive.receive(new ReceiveDraft({ text }));
      const proofs = yield* (yield* ProofStore).loadAll;
      return { receipt, proofs };
    }),
  );
