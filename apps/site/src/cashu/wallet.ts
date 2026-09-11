import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  InsufficientFunds,
  MintRejected,
  Bolt11Invoice,
  buildPaymentAmountAttempts,
  buildPaymentFailureAmountAttempts,
  encodeToken,
  fetchLnurlInvoiceForTarget,
  GENERIC_MINT_ICON_DATA_URL,
  getMintIconOverride,
  isRetryablePaymentAmountFailure,
  Melt,
  MeltDraft,
  MeltQuote,
  Mints,
  parseTokenText,
  normalizeTokenText,
  isTestMintUrl,
  Restore,
  RestoreDraft,
  runLinkshu,
  Tokens,
  Validation,
} from "@linky/linkshu";
import type { LinkshuServices, StoredProof, TokenText } from "@linky/linkshu";
import { Effect, Schema } from "effect";
import { walletStorage } from "./walletStorage";

export interface TokenSnapshot {
  amount: number;
  iconUrl: string;
  isValid: boolean;
  mint: string;
  mintHost: string;
  totalAmount: number;
  unit: string;
}
export class RedeemError extends Error {
  readonly phase: "invoice_fetch" | "melt";
  constructor(message: string, phase: "invoice_fetch" | "melt") {
    super(message);
    this.phase = phase;
  }
}
export const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : fallback;

const PendingPayment = Schema.parseJson(
  Schema.Struct({
    quote: MeltQuote,
    invoice: Bolt11Invoice,
    address: Schema.String,
  }),
);
const CompletedPayment = Schema.parseJson(
  Schema.Struct({
    amountSent: Schema.Number,
    changeAmount: Schema.Number,
    changeToken: Schema.NullOr(Schema.String),
    feePaid: Schema.NullOr(Schema.Number),
    mint: Schema.String,
    lightningAddress: Schema.String,
  }),
);

const withWallet = async <A>(
  token: string,
  use: (
    run: <V, E>(effect: Effect.Effect<V, E, LinkshuServices>) => Promise<V>,
    key: string,
    text: TokenText,
  ) => Promise<A>,
): Promise<A> => {
  const parsed = parseTokenText(token);
  if (!parsed?.mint || parsed.unit !== "sat")
    throw new Error("Invalid sat token");
  const text = normalizeTokenText(token);
  if (!text) throw new Error("Invalid token");
  const key = `linky.site.wallet.${bytesToHex(sha256(new TextEncoder().encode(text)))}`;
  return navigator.locks.request(key, async () => {
    const config = walletStorage(key);
    const run = async <V, E>(
      effect: Effect.Effect<V, E, LinkshuServices>,
    ): Promise<V> => {
      const result = await runLinkshu(config, Effect.either(effect));
      if (result._tag === "Left") throw result.left;
      return result.right;
    };
    // The pasted token's proofs are trusted as-is: the site never re-signs
    // them, it only spends them.
    await run(
      Effect.gen(function* () {
        const tokens = yield* Tokens;
        if (
          (yield* tokens.proofs).length === 0 &&
          localStorage.getItem(`${key}.initialized`) === null
        ) {
          yield* tokens.adoptToken(text);
          localStorage.setItem(`${key}.initialized`, "1");
        }
      }),
    );
    return use(run, key, text);
  });
};

const availableProofs = (proofs: readonly StoredProof[]) =>
  proofs.filter((proof) => proof.state === "available");

/** The wallet's remaining balance as one token the user can keep. */
const remainingToken = (proofs: readonly StoredProof[]): string | null => {
  const [first, ...rest] = proofs;
  if (!first) return null;
  const toProof = (proof: StoredProof) => ({
    id: proof.keysetId,
    amount: proof.amount,
    secret: proof.secret,
    C: proof.C,
  });
  return encodeToken({
    mint: first.mint,
    unit: first.unit,
    memo: null,
    proofs: [toProof(first), ...rest.map(toProof)],
  });
};

export const inspectToken = (token: string): Promise<TokenSnapshot> =>
  withWallet(token, async (run, key) => {
    const parsed = parseTokenText(token);
    if (!parsed?.mint) throw new Error("Invalid token");
    const mint = parsed.mint;
    const pending = localStorage.getItem(`${key}.payment`);
    if (!pending) {
      const report = await run(
        Effect.flatMap(Validation, (validation) => validation.checkAll),
      );
      if (report.unavailableMints.length) throw new Error("Mint unavailable");
    }
    const balance = await run(
      Effect.flatMap(Tokens, (tokens) => tokens.balances),
    );
    const info = await run(Effect.flatMap(Mints, (mints) => mints.info(mint)));
    const mintHost = new URL(mint).host;
    const amount = pending
      ? Schema.decodeUnknownSync(PendingPayment)(pending).quote.amount
      : balance.total;
    return {
      amount,
      totalAmount: parsed.amount,
      isValid: amount > 0,
      mint,
      mintHost,
      unit: parsed.unit ?? "sat",
      iconUrl:
        getMintIconOverride(mintHost) ??
        info.iconUrl ??
        GENERIC_MINT_ICON_DATA_URL,
    };
  });

export const redeemToken = (
  token: string,
  lightningAddress: string,
  comment?: string,
) =>
  withWallet(token, async (run, key) => {
    const parsed = parseTokenText(token);
    if (!parsed?.mint) throw new Error("Invalid token");
    const mint = parsed.mint;
    const info = await run(Effect.flatMap(Mints, (mints) => mints.info(mint)));
    const allowTestMint =
      import.meta.env.VITE_ALLOW_TEST_MINT === "1" && isTestMintUrl(mint);
    if (info.isFakeLightning && !allowTestMint)
      throw new RedeemError(
        "This testing mint cannot send a real Lightning payment",
        "melt",
      );
    const completed = localStorage.getItem(`${key}.completed`);
    if (completed) return Schema.decodeUnknownSync(CompletedPayment)(completed);
    const finish = async (
      amountSent: number,
      feePaid: number | null,
      address: string,
    ) => {
      const proofs = availableProofs(
        await run(Effect.flatMap(Tokens, (tokens) => tokens.proofs)),
      );
      const result = {
        amountSent,
        feePaid,
        mint,
        lightningAddress: address,
        changeAmount: proofs.reduce((sum, proof) => sum + proof.amount, 0),
        changeToken: remainingToken(proofs),
      };
      localStorage.setItem(
        `${key}.completed`,
        Schema.encodeSync(CompletedPayment)(result),
      );
      localStorage.removeItem(`${key}.payment`);
      return result;
    };
    // Settles held melt inputs from the mint's own answer: PAID reclaims
    // change, UNPAID returns the inputs, PENDING keeps both.
    const settlePendingMelts = () =>
      run(Effect.flatMap(Melt, (melt) => melt.resumePending));
    // A rejected melt frees its inputs only once the mint itself reports the quote unpaid.
    const releaseUnpaidAttempt = async () => {
      const pendingText = localStorage.getItem(`${key}.payment`);
      if (!pendingText) return;
      const { quote } = Schema.decodeUnknownSync(PendingPayment)(pendingText);
      const state = await run(
        Effect.orElseSucceed(
          Effect.flatMap(Melt, (melt) => melt.status(quote)),
          () => null,
        ),
      );
      if (state !== "UNPAID") return;
      await settlePendingMelts();
      localStorage.removeItem(`${key}.payment`);
    };
    const pendingText = localStorage.getItem(`${key}.payment`);
    if (pendingText) {
      const pending = Schema.decodeUnknownSync(PendingPayment)(pendingText);
      const state = await run(
        Effect.flatMap(Melt, (melt) => melt.status(pending.quote)),
      );
      if (state !== "PAID" && state !== "UNPAID")
        throw new RedeemError(
          "Payment is pending. Check again before sending another payment.",
          "melt",
        );
      await settlePendingMelts();
      const restored = await run(
        Effect.flatMap(Restore, (restore) =>
          restore.restore(new RestoreDraft({ mints: [mint] })),
        ),
      );
      const validated = await run(
        Effect.flatMap(Validation, (validation) => validation.checkAll),
      );
      if (restored.unavailableMints.length || validated.unavailableMints.length)
        throw new RedeemError(
          "Could not recover payment change from the mint. Try again.",
          "melt",
        );
      if (state === "PAID")
        return finish(pending.quote.amount, null, pending.address);
      // The mint confirmed the invoice unpaid. Deterministic outputs are recovered before another attempt.
      localStorage.removeItem(`${key}.payment`);
    }
    const balances = await run(
      Effect.flatMap(Tokens, (tokens) => tokens.balances),
    );
    const attempts = buildPaymentAmountAttempts(balances.total, balances.total);
    const seen = new Set(attempts);
    let lastError: unknown = new Error("Token is already spent");
    for (const amount of attempts) {
      let phase: "invoice_fetch" | "melt" = "invoice_fetch";
      try {
        const fallback = async (url: string): Promise<Response> => {
          const direct = new URL(url);
          const proxy = new URL("/api/lnurlp", window.location.origin);
          proxy.searchParams.set("address", lightningAddress);
          for (const field of ["amount", "comment"]) {
            const value = direct.searchParams.get(field);
            if (value) proxy.searchParams.set(field, value);
          }
          const response = await fetch(proxy);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response;
        };
        const invoice = await fetchLnurlInvoiceForTarget(
          lightningAddress,
          amount,
          comment,
          fallback,
        );
        phase = "melt";
        const draft = new MeltDraft({
          mint,
          invoice: Bolt11Invoice.make(invoice.pr),
        });
        const quote = await run(
          Effect.flatMap(Melt, (melt) => melt.quote(draft)),
        );
        if (quote.amount + quote.feeReserve > balances.total)
          throw new Error(
            `Insufficient funds: required ${quote.amount + quote.feeReserve}, available ${balances.total}`,
          );
        localStorage.setItem(
          `${key}.payment`,
          Schema.encodeSync(PendingPayment)({
            quote,
            invoice: draft.invoice,
            address: lightningAddress,
          }),
        );
        const receipt = await run(
          Effect.flatMap(Melt, (melt) =>
            melt.melt(new MeltDraft({ ...draft, quoteId: quote.quoteId })),
          ),
        );
        return finish(receipt.paidAmount, receipt.feePaid, lightningAddress);
      } catch (error) {
        lastError = error;
        const message =
          error instanceof InsufficientFunds
            ? `Insufficient funds: required ${error.required}, available ${error.available}`
            : error instanceof MintRejected
              ? error.detail
              : getErrorMessage(error, "Redeem failed");
        if (error instanceof InsufficientFunds)
          localStorage.removeItem(`${key}.payment`);
        else if (error instanceof MintRejected) await releaseUnpaidAttempt();
        if (
          localStorage.getItem(`${key}.payment`) ||
          !isRetryablePaymentAmountFailure(message)
        )
          throw new RedeemError(message, phase);
        for (const retry of buildPaymentFailureAmountAttempts(
          amount,
          message,
        )) {
          if (!seen.has(retry)) {
            seen.add(retry);
            attempts.push(retry);
          }
        }
      }
    }
    throw new RedeemError(getErrorMessage(lastError, "Redeem failed"), "melt");
  });
