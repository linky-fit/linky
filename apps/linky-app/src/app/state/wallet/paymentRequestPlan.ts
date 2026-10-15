import {
  mintMoveCovers,
  planSendMint,
  type MintUrl,
  type WalletBalances,
} from "@linky-fit/linkshu";
import { isHiddenTestMint, normalizeMintUrl } from "../../../utils/mint";
import { isSpellingOf } from "../../lib/mintSpelling";
import { planDefaultMintMove } from "./moveFunds";

interface MintBalance {
  readonly mint: MintUrl;
  readonly amount: number;
}

/** How the wallet can pay a NUT-18 request of a given amount. */
export type PaymentRequestMintPlan =
  /**
   * A mint the wallet holds covers it; `methodFee` is the request's `mf`
   * owed for paying from outside its mint list.
   */
  | {
      readonly _tag: "Direct";
      readonly mint: MintUrl;
      readonly methodFee: number;
    }
  /** Only a move into the default mint, which the request accepts, makes one mint cover it. */
  | {
      readonly _tag: "NeedsMintMove";
      readonly fromMint: MintUrl;
      readonly toMint: MintUrl;
    }
  /**
   * Lightning moves the amount from a mint the request does not accept into
   * `targetMint`, which it does. `sources` are the candidates, smallest
   * balance first; the move's fees decide which one covers it.
   */
  | {
      readonly _tag: "Lightning";
      readonly targetMint: string;
      /** The target is not in the user's mint list yet. */
      readonly addsMint: boolean;
      readonly sources: ReadonlyArray<MintBalance>;
    }
  | { readonly _tag: "Insufficient" };

export interface PlanPaymentRequestMintArgs {
  readonly amount: number;
  /** The request's `m`; empty accepts any mint. */
  readonly acceptedMints: ReadonlyArray<string>;
  /** The request's `mp`: other mints are accepted too, after `acceptedMints`. */
  readonly mintsAdvisory?: boolean;
  /** The request's `mf`, owed when paying from outside `acceptedMints`. */
  readonly outsideMintFee?: number;
  readonly allowTestMints: boolean;
  readonly balances: WalletBalances;
  readonly defaultMint: string | null;
  /** The user's mint list, default mint first. */
  readonly userMints: ReadonlyArray<string>;
  /** What a send of `amount` at `mint` costs on top of it; none when omitted. */
  readonly sendFee?: (mint: MintUrl, amount: number) => number;
}

export const planPaymentRequestMint = ({
  amount,
  acceptedMints,
  mintsAdvisory = false,
  outsideMintFee = 0,
  allowTestMints,
  balances,
  defaultMint,
  userMints,
  sendFee = () => 0,
}: PlanPaymentRequestMintArgs): PaymentRequestMintPlan => {
  if (!Number.isFinite(amount) || amount <= 0) return { _tag: "Insufficient" };
  const anyMint = acceptedMints.length === 0;
  const accepted = [
    ...new Set(
      acceptedMints
        .map(normalizeMintUrl)
        .filter((mint) => mint && !isHiddenTestMint(mint, allowTestMints)),
    ),
  ];
  const isAccepted = (mint: string) =>
    anyMint || accepted.includes(normalizeMintUrl(mint));
  const visible = balances.perMint.filter(
    (entry) => !isHiddenTestMint(entry.mint, allowTestMints),
  );

  const directFrom = (
    entries: ReadonlyArray<MintBalance>,
    methodFee: number,
  ): PaymentRequestMintPlan | null => {
    const mint = planSendMint({
      balances: entries.filter(
        (entry) =>
          entry.amount >= amount + methodFee + sendFee(entry.mint, amount),
      ),
      amount,
      isPreferredMint: isSpellingOf(defaultMint),
    });
    return mint === null ? null : { _tag: "Direct", mint, methodFee };
  };
  const direct =
    directFrom(
      visible.filter((entry) => isAccepted(entry.mint)),
      anyMint ? outsideMintFee : 0,
    ) ??
    (mintsAdvisory
      ? directFrom(
          visible.filter((entry) => !isAccepted(entry.mint)),
          outsideMintFee,
        )
      : null);
  if (direct !== null) return direct;

  const move = planDefaultMintMove(visible, defaultMint);
  const spendable = Math.max(0, ...visible.map((entry) => entry.amount));
  if (
    move !== null &&
    isAccepted(move.toMint) &&
    !isHiddenTestMint(move.toMint, allowTestMints) &&
    mintMoveCovers({ plan: move, amount, spendable })
  )
    return {
      _tag: "NeedsMintMove",
      fromMint: move.fromMint,
      toMint: move.toMint,
    };

  const known = userMints.map(normalizeMintUrl);
  const targetMint =
    known.find((mint) => accepted.includes(mint)) ?? accepted[0] ?? null;
  // Any mint accepted means any source would have paid directly.
  if (targetMint === null) return { _tag: "Insufficient" };
  const sources = visible
    .filter(
      (entry) =>
        entry.amount > amount && normalizeMintUrl(entry.mint) !== targetMint,
    )
    .sort((a, b) => a.amount - b.amount);
  if (sources.length === 0) return { _tag: "Insufficient" };
  return {
    _tag: "Lightning",
    targetMint,
    addsMint: !known.includes(targetMint),
    sources,
  };
};

/**
 * Allowance for the input fees (NUT-02) of paying `amount` from a mint
 * charging `inputFeePpk`: the payer's send swap and the payee's redemption,
 * which NUT-18 puts on the payer. Each side spends at most one proof per bit
 * of the amount, plus one proof carrying the fee.
 */
export const sendFeeAllowance = (
  inputFeePpk: number | null,
  amount: number,
): number => {
  if (inputFeePpk === null || inputFeePpk <= 0) return 0;
  const proofs = Math.trunc(amount).toString(2).length + 1;
  return 2 * Math.ceil((inputFeePpk * proofs) / 1000);
};
