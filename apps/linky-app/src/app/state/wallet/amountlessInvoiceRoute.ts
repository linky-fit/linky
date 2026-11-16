import { MintUrl, planSendMint, type WalletBalances } from "@linky-fit/linkshu";
import { Predicate, Result } from "effect";
import { getInspectorEmissionEnabled } from "../../../devtools/inspector/inspectorEnabled";
import { reportInspectorRows } from "../../../devtools/inspector/reportInspectorRows";
import { isHiddenTestMint, normalizeMintUrl } from "../../../utils/mint";
import { isSpellingOf } from "../../lib/mintSpelling";
import type { LinkshuCommands } from "../linkshu/commands";

/**
 * Where an invoice without an amount is paid from. Only mints advertising
 * NUT-23 amountless melts can pay one, so without funds at such a mint the
 * amount first moves over Lightning into one from the user's mint list.
 */
export type AmountlessInvoiceRoute =
  | { readonly _tag: "Direct"; readonly mint: MintUrl }
  | {
      readonly _tag: "Lightning";
      readonly sourceMint: MintUrl;
      readonly targetMint: MintUrl;
      /** What lands at the target: the melt's cost less what the target already holds. */
      readonly moveAmount: number;
      /** What the payment costs on top of the amount, the move included. */
      readonly fee: number;
    }
  | { readonly _tag: "Unsupported" }
  | { readonly _tag: "Insufficient" }
  | { readonly _tag: "Failed"; readonly error: unknown };

export interface AmountlessInvoiceRouteArgs {
  readonly invoice: string;
  readonly amountSat: number;
  readonly balances: WalletBalances;
  readonly defaultMint: string | null;
  readonly allowTestMints: boolean;
  /** The user's mint list, default mint first. */
  readonly userMints: ReadonlyArray<string>;
  readonly linkshu: Pick<
    LinkshuCommands,
    "estimateAutoswapCashu" | "fetchMintInfo" | "quoteCashuMelt"
  >;
}

export const routeAmountlessInvoice = async ({
  invoice,
  amountSat,
  balances,
  defaultMint,
  allowTestMints,
  userMints,
  linkshu,
}: AmountlessInvoiceRouteArgs): Promise<AmountlessInvoiceRoute> => {
  const funded = balances.perMint.filter(
    (entry) =>
      entry.amount > 0 && !isHiddenTestMint(entry.mint, allowTestMints),
  );
  const candidates = [
    ...new Set([
      ...funded.map((entry) => normalizeMintUrl(entry.mint)),
      ...userMints
        .map(normalizeMintUrl)
        .filter((mint) => mint && !isHiddenTestMint(mint, allowTestMints)),
    ]),
  ];
  const capable = new Set<string>();
  await Promise.all(
    candidates.map(async (mint) => {
      try {
        const info = await linkshu.fetchMintInfo(mint);
        if (Result.isSuccess(info) && info.success.supportsAmountlessMelt)
          capable.add(mint);
      } catch {
        // An unreachable mint pays nothing; the others may.
      }
    }),
  );
  const isCapable = (mint: string) => capable.has(normalizeMintUrl(mint));

  const direct = planSendMint({
    balances: funded.filter((entry) => isCapable(entry.mint)),
    amount: amountSat,
    isPreferredMint: isSpellingOf(defaultMint),
  });
  if (direct !== null) return { _tag: "Direct", mint: direct };

  const targets = userMints
    .map(normalizeMintUrl)
    .filter(
      (mint, index, all) => isCapable(mint) && all.indexOf(mint) === index,
    );
  if (targets.length === 0) return { _tag: "Unsupported" };

  let lastError: unknown = null;
  for (const targetMint of targets) {
    const held = funded.filter(
      (entry) => normalizeMintUrl(entry.mint) === targetMint,
    );
    const atTarget = held.reduce((sum, entry) => sum + entry.amount, 0);
    try {
      const priced = await linkshu.quoteCashuMelt({
        invoice,
        mint: targetMint,
        amountSat,
      });
      if (Result.isFailure(priced)) {
        lastError = priced.failure;
        continue;
      }
      const { maxTotal } = priced.success;
      const moveAmount = maxTotal - atTarget;
      const sources = funded
        .filter(
          (entry) =>
            normalizeMintUrl(entry.mint) !== targetMint &&
            entry.amount > moveAmount,
        )
        .sort((a, b) => a.amount - b.amount);
      for (const source of sources) {
        const estimated = await linkshu.estimateAutoswapCashu({
          sourceMint: source.mint,
          targetMint,
          amountSat: moveAmount,
        });
        if (Result.isFailure(estimated)) {
          if (!Predicate.isTagged(estimated.failure, "InsufficientFunds"))
            lastError = estimated.failure;
          continue;
        }
        const { totalFromSource } = estimated.success;
        if (totalFromSource > source.amount) continue;
        return {
          _tag: "Lightning",
          sourceMint: source.mint,
          targetMint: MintUrl.make(targetMint),
          moveAmount,
          fee: totalFromSource + atTarget - amountSat,
        };
      }
    } catch (error) {
      lastError = error;
    }
  }
  return lastError === null
    ? { _tag: "Insufficient" }
    : { _tag: "Failed", error: lastError };
};

/** How the wallet chose to pay an invoice without an amount, before anything moved. */
export const reportAmountlessInvoiceRouted = (
  amountSat: number,
  route: AmountlessInvoiceRoute,
): void => {
  if (!getInspectorEmissionEnabled()) return;
  const mint =
    route._tag === "Direct"
      ? route.mint
      : route._tag === "Lightning"
        ? route.targetMint
        : null;
  reportInspectorRows([
    {
      at: Date.now(),
      channel: "app.log",
      tag: "lightningInvoice.amountlessRouted",
      summary: `pay ${amountSat} sat amountless invoice: ${route._tag}`,
      links: {},
      ...(mint === null ? {} : { context: { mint } }),
      payload: {
        amount: amountSat,
        route: route._tag,
        mint,
        sourceMint: route._tag === "Lightning" ? route.sourceMint : null,
        moveAmount: route._tag === "Lightning" ? route.moveAmount : null,
        fee: route._tag === "Lightning" ? route.fee : null,
      },
    },
  ]);
};

/** The Lightning move that funds an amountless invoice at a mint able to pay it. */
export const reportAmountlessInvoiceMove = (args: {
  readonly sourceMint: string;
  readonly targetMint: string;
  readonly moveAmount: number;
  readonly outcome: "moved" | "failed";
  readonly operationId: string | null;
  readonly feePaid: number | null;
  readonly detail: string | null;
}): void => {
  if (!getInspectorEmissionEnabled()) return;
  reportInspectorRows([
    {
      at: Date.now(),
      channel: "cashu",
      tag: "lightningInvoice.amountlessMove",
      summary: `amountless invoice move ${args.moveAmount} sat ${args.outcome}`,
      links: args.operationId === null ? {} : { operation: args.operationId },
      context: { mint: args.targetMint },
      payload: args,
    },
  ]);
};
