import {
  Amount,
  Mint,
  MintOperationError,
  MintQuoteState,
  splitAmount,
} from "@cashu/cashu-ts";
import type {
  HasKeysetKeys,
  OutputData,
  SerializedBlindedSignature,
} from "@cashu/cashu-ts";
import type { ClaimRow, Database, PaidQuote, StoredProof } from "./db";
import { deriveOutputs } from "./outputs";

const QUOTE_EXPIRED_CODE = 20007;

type SignedOutput = readonly [OutputData, SerializedBlindedSignature];

/**
 * Mints claims with outputs derived from the seed. Every step is safe to
 * repeat and to run concurrently: a second mint call with the same outputs
 * fails at the mint, and the next restore returns the signatures.
 */
export class Minter {
  private readonly mints = new Map<string, Mint>();
  private readonly keysets = new Map<string, HasKeysetKeys>();
  private readonly restoreSupport = new Map<string, boolean>();
  private readonly db: Database;
  private readonly seed: Uint8Array;

  constructor(db: Database, seed: Uint8Array) {
    this.db = db;
    this.seed = seed;
  }

  mint(mintUrl: string): Mint {
    let mint = this.mints.get(mintUrl);
    if (!mint) {
      mint = new Mint(mintUrl);
      this.mints.set(mintUrl, mint);
    }
    return mint;
  }

  /** Inserts the claim for a paid v3 quote and mints it, unless another worker took it first. */
  async startClaim(quote: PaidQuote): Promise<void> {
    const row = await this.db.insertClaim({
      ...quote,
      output_amounts: null,
      status: "minting",
    });
    if (row) await this.finishMinting(row);
  }

  /** Moves an `unpaid` or `minting` claim toward an end state; other statuses are final here. */
  async advance(row: ClaimRow): Promise<void> {
    if (row.status === "unpaid") await this.advanceUnpaid(row);
    if (row.status === "minting") await this.finishMinting(row);
  }

  private async advanceUnpaid(row: ClaimRow): Promise<void> {
    const quote = await this.mint(row.mint_url).checkMintQuoteBolt11(
      row.quote_id,
    );
    if (quote.state === MintQuoteState.ISSUED) {
      await this.db.moveClaim(row, "unpaid", "issued_elsewhere");
    } else if (quote.state === MintQuoteState.PAID) {
      if (await this.db.moveClaim(row, "unpaid", "minting")) {
        await this.finishMinting({ ...row, status: "minting" });
      }
    } else if (quote.expiry !== null && quote.expiry * 1000 < Date.now()) {
      await this.db.deleteUnpaidClaim(row);
    }
  }

  private async finishMinting(row: ClaimRow): Promise<void> {
    const mint = this.mint(row.mint_url);
    const keyset = await this.activeKeyset(row.mint_url);
    const amounts =
      row.output_amounts ??
      (await this.db.fixOutputAmounts(row, outputAmounts(row.amount, keyset)));
    const outputs = deriveOutputs(
      this.seed,
      row.mint_url,
      row.quote_id,
      amounts,
      keyset.id,
    );

    const restored = await this.restore(row.mint_url, outputs);
    if (restored?.length === outputs.length) {
      return this.db.storeProofs(row, restored);
    }
    if (restored && restored.length > 0) {
      throw new Error(`partial restore for quote ${row.quote_id}, retrying`);
    }

    const quote = await mint.checkMintQuoteBolt11(row.quote_id);
    if (quote.state === MintQuoteState.ISSUED) {
      await this.db.moveClaim(row, "minting", "issued_elsewhere");
      return;
    }
    if (quote.state !== MintQuoteState.PAID) return;

    try {
      const { signatures } = await mint.mintBolt11({
        quote: row.quote_id,
        outputs: outputs.map((output) => output.blindedMessage),
      });
      const signed = outputs.flatMap((output, index): SignedOutput[] => {
        const signature = signatures[index];
        return signature ? [[output, signature]] : [];
      });
      await this.db.storeProofs(row, await this.toProofs(row.mint_url, signed));
    } catch (error) {
      if (
        error instanceof MintOperationError &&
        error.code === QUOTE_EXPIRED_CODE
      ) {
        await this.db.moveClaim(row, "minting", "expired");
        return;
      }
      throw error;
    }
  }

  /** The proofs the mint already signed for these outputs, or null when it has no NUT-09. */
  private async restore(
    mintUrl: string,
    outputs: readonly OutputData[],
  ): Promise<StoredProof[] | null> {
    if (!(await this.supportsRestore(mintUrl))) return null;
    const response = await this.mint(mintUrl).restore({
      outputs: outputs.map((output) => output.blindedMessage),
    });
    const byBlindedMessage = new Map(
      outputs.map((output) => [output.blindedMessage.B_, output]),
    );
    const signed = response.outputs.flatMap(
      (restored, index): SignedOutput[] => {
        const output = byBlindedMessage.get(restored.B_);
        const signature = response.signatures[index];
        return output && signature ? [[output, signature]] : [];
      },
    );
    return this.toProofs(mintUrl, signed);
  }

  /** Amount and keyset come from each signature, so outputs signed on a rotated keyset still unblind. */
  private async toProofs(
    mintUrl: string,
    signed: readonly SignedOutput[],
  ): Promise<StoredProof[]> {
    return Promise.all(
      signed.map(async ([output, signature]) => {
        const proof = output.toProof(
          signature,
          await this.keyset(mintUrl, signature.id),
        );
        return {
          id: proof.id,
          amount: Amount.from(proof.amount).toNumber(),
          secret: proof.secret,
          C: proof.C,
        };
      }),
    );
  }

  private async supportsRestore(mintUrl: string): Promise<boolean> {
    let supported = this.restoreSupport.get(mintUrl);
    if (supported === undefined) {
      const info = await this.mint(mintUrl).getInfo();
      supported = info.nuts["9"]?.supported === true;
      this.restoreSupport.set(mintUrl, supported);
    }
    return supported;
  }

  private async activeKeyset(mintUrl: string): Promise<HasKeysetKeys> {
    const { keysets } = await this.mint(mintUrl).getKeySets();
    const [cheapest] = keysets
      .filter((keyset) => keyset.active && keyset.unit === "sat")
      .sort((a, b) => (a.input_fee_ppk ?? 0) - (b.input_fee_ppk ?? 0));
    if (!cheapest) throw new Error(`${mintUrl} has no active sat keyset`);
    return this.keyset(mintUrl, cheapest.id);
  }

  private async keyset(mintUrl: string, id: string): Promise<HasKeysetKeys> {
    const cacheKey = `${mintUrl} ${id}`;
    let keyset = this.keysets.get(cacheKey);
    if (!keyset) {
      const { keysets } = await this.mint(mintUrl).getKeys(id);
      const keys = keysets.find((candidate) => candidate.id === id)?.keys;
      if (!keys) throw new Error(`${mintUrl} has no keys for keyset ${id}`);
      keyset = { id, keys };
      this.keysets.set(cacheKey, keyset);
    }
    return keyset;
  }
}

/** A power-of-two split of the amount over the keyset's denominations. */
const outputAmounts = (amount: number, keyset: HasKeysetKeys): number[] =>
  splitAmount(amount, keyset.keys).map((part) => part.toNumber());
