import type { MeltQuoteBolt11Response } from "@cashu/cashu-ts";
import { Duration, Effect, Schema } from "effect";
import { MintRejected, MintUnreachable } from "../domain/errors";
import { Amount, NonNegativeAmount } from "../domain/primitives";
import type { MintUrl, QuoteId } from "../domain/primitives";
import { LightningFeeProbed } from "../inspector/events";
import { Inspector } from "../inspector/Inspector";
import { cashuAmountToNumber } from "../internal/cashuAmounts";
import { inspectOperationWith } from "../internal/operations";
import { decodeMintQuote, decodeQuoteId } from "../internal/quotes";
import type { DecodedMintQuote } from "../internal/quotes";
import { nowSeconds } from "../internal/time";
import { sat } from "../internal/units";
import {
  classifyMintError,
  WalletInstances,
} from "../mint/internal/WalletInstances";
import type { LoadedWallet } from "../mint/internal/WalletInstances";
import { KeyValueStore } from "../ports/KeyValueStore";
import { LightningFeeProbeResult } from "./domain";
import type { FeeProbeDraft, FeeProbeError } from "./domain";
import {
  readCachedFeeProbe,
  writeCachedFeeProbe,
} from "./internal/feeProbeCache";

/** Large enough that a mint's percentage fee is readable, as in the app. */
const DEFAULT_PROBE_AMOUNT = 10_000;
/** Two mints answer in series; past this the probe is not worth waiting on. */
const PROBE_TIMEOUT = Duration.seconds(15);

const decodeAmount = Schema.decodeUnknownOption(Amount);
const decodeReserve = Schema.decodeUnknownOption(NonNegativeAmount);

/**
 * Lightning fee estimation. NUT-06 publishes no Lightning fee, so the only
 * way to learn one is to request a melt quote for a real invoice: quote a
 * mint quote at `probeMint`, ask `mint` to price melting against it, and read
 * the fee reserve. Nothing pays the invoice, so no funds move. Results are
 * cached in storage per mint with a day-scale TTL. Cashu-side input fees
 * (`input_fee_ppk`) are a separate figure, exposed on `MintInfo`.
 */
export class FeeProbe extends Effect.Service<FeeProbe>()("linkshu/FeeProbe", {
  dependencies: [WalletInstances.Default],
  effect: Effect.gen(function* () {
    const kv = yield* KeyValueStore;
    const instances = yield* WalletInstances;
    const inspector = yield* Inspector.orNoop;

    const probeInvoice = (
      wallet: LoadedWallet,
      probeMint: MintUrl,
      amount: number,
    ): Effect.Effect<DecodedMintQuote, MintUnreachable | MintRejected> =>
      Effect.flatMap(
        Effect.tryPromise({
          try: () => wallet.createMintQuoteBolt11(amount),
          catch: (error) => classifyMintError(probeMint, error),
        }),
        (raw) => decodeMintQuote(probeMint, raw),
      );

    /**
     * The melt quote priced. The mint's own `amount` is authoritative when it
     * is usable; a mint that echoes nothing back leaves the requested size as
     * the denominator.
     */
    const priceFrom = (
      draft: FeeProbeDraft,
      requested: number,
      raw: MeltQuoteBolt11Response,
    ): Effect.Effect<
      { result: LightningFeeProbeResult; meltQuoteId: QuoteId },
      MintRejected
    > => {
      const feeReserve = decodeReserve(cashuAmountToNumber(raw.fee_reserve));
      const meltQuoteId = decodeQuoteId(raw.quote);
      if (feeReserve._tag === "None" || meltQuoteId._tag === "None") {
        return Effect.fail(
          new MintRejected({
            mint: draft.mint,
            code: null,
            detail: "mint returned a melt quote without a usable fee reserve",
          }),
        );
      }
      const quoted = decodeAmount(cashuAmountToNumber(raw.amount));
      const amount =
        quoted._tag === "Some" ? quoted.value : Amount.make(requested);
      return Effect.succeed({
        meltQuoteId: meltQuoteId.value,
        result: new LightningFeeProbeResult({
          mint: draft.mint,
          probeMint: draft.probeMint,
          amount,
          feeReserve: feeReserve.value,
          percent: (feeReserve.value / amount) * 100,
        }),
      });
    };

    const runProbe = (
      draft: FeeProbeDraft,
    ): Effect.Effect<LightningFeeProbeResult, FeeProbeError> =>
      Effect.gen(function* () {
        const amount = draft.amount ?? DEFAULT_PROBE_AMOUNT;
        const probeWallet = yield* instances.get(draft.probeMint, sat);
        const probe = yield* probeInvoice(probeWallet, draft.probeMint, amount);

        const wallet = yield* instances.get(draft.mint, sat);
        const raw = yield* Effect.tryPromise({
          try: () => wallet.createMeltQuoteBolt11(probe.invoice),
          catch: (error) => classifyMintError(draft.mint, error),
        });
        const { result, meltQuoteId } = yield* priceFrom(draft, amount, raw);

        yield* writeCachedFeeProbe(kv, result, yield* nowSeconds);
        inspector.emit(
          () =>
            new LightningFeeProbed(
              {
                mint: result.mint,
                probeMint: result.probeMint,
                meltQuoteId,
                mintQuoteId: probe.quoteId,
                amount: result.amount,
                feeReserve: result.feeReserve,
                percent: result.percent,
              },
              { disableValidation: true },
            ),
        );
        return result;
      }).pipe(
        Effect.timeoutFail({
          duration: PROBE_TIMEOUT,
          onTimeout: () =>
            new MintUnreachable({
              mint: draft.mint,
              detail: "the fee probe did not finish in time",
            }),
        }),
      );

    /** A fresh cached estimate short-circuits the two quotes it would cost. */
    const probeLightningFee = (
      draft: FeeProbeDraft,
    ): Effect.Effect<LightningFeeProbeResult, FeeProbeError> =>
      Effect.gen(function* () {
        const cached = yield* readCachedFeeProbe(
          kv,
          draft.mint,
          yield* nowSeconds,
        );
        return cached ?? (yield* runProbe(draft));
      }).pipe(
        inspectOperationWith(
          inspector,
          "feeProbe.probeLightningFee",
          { mint: draft.mint, probeMint: draft.probeMint },
          (result) => result,
        ),
      );

    return { probeLightningFee } as const;
  }),
}) {}
