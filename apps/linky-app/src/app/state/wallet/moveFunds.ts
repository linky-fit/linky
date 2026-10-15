import {
  planMintMove,
  type AutoswapEstimate,
  type AutoswapReceipt,
  type MintMovePlan,
  type MintUrl,
} from "@linky-fit/linkshu";
import { Option, Result } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";
import {
  MAIN_MINT_URL,
  normalizeMintUrl,
  toMintUrl,
} from "../../../utils/mint";
import { getUnknownErrorMessage } from "../../../utils/unknown";
import { describeTaggedCashuError } from "../../lib/cashuStoredError";
import { visibleWalletBalances } from "../../lib/testMintGate";
import { linkshuCommandsAtom, type LinkshuCommands } from "../linkshu/commands";
import { allowTestMintsAtom } from "../session/settings";
import { defaultMintAtom } from "./defaultMint";
import { walletOpsAtom, type WalletOps } from "./opQueue";
import { ownerStorageAtom } from "./ownerStorage";

export interface MintMove {
  readonly sourceMint: string;
  readonly targetMint: string;
  /** What arrives at the target mint; absent sweeps the whole balance. */
  readonly amountSat?: number;
}

export type EstimateMintMoveOutcome =
  | { readonly _tag: "Estimated"; readonly estimate: AutoswapEstimate }
  | { readonly _tag: "Unavailable" }
  | { readonly _tag: "Failed"; readonly detail: string };

export type MoveMintFundsOutcome =
  | { readonly _tag: "Moved"; readonly receipt: AutoswapReceipt }
  /** The source paid the target's invoice; the persisted claim finishes the move. */
  | { readonly _tag: "ClaimPending" }
  | { readonly _tag: "Unavailable" }
  | { readonly _tag: "Busy" }
  | { readonly _tag: "Failed"; readonly detail: string };

export type MeltToDefaultMintOutcome =
  | {
      readonly _tag: "Moved";
      readonly movedAmount: number;
      readonly targetMint: string;
    }
  | { readonly _tag: "ClaimPending"; readonly amount: number }
  | { readonly _tag: "InvalidTarget" }
  | { readonly _tag: "Unavailable" }
  | { readonly _tag: "Busy" }
  | { readonly _tag: "Failed"; readonly detail: string };

interface MoveOptions {
  /** Runs once the wallet queue admitted the move, before any mint call. */
  readonly onStarted?: () => void;
}

export interface MoveFundsCommands {
  /** Prices a move; the estimate's `sourceMint` is the spelling a following move must use. */
  readonly estimateMintMove: (
    move: MintMove,
  ) => Promise<EstimateMintMoveOutcome>;
  /** Moves from `move.sourceMint` as given, the spelling its estimate priced. */
  readonly moveMintFunds: (
    move: MintMove,
    options?: MoveOptions,
  ) => Promise<MoveMintFundsOutcome>;
  /** Sweeps the largest other mint into the default mint, on the user's confirmation. */
  readonly meltToDefaultMint: (
    options?: MoveOptions,
  ) => Promise<MeltToDefaultMintOutcome>;
}

const describeError = (error: unknown): string =>
  describeTaggedCashuError(error) ?? getUnknownErrorMessage(error, "unknown");

/**
 * The move that sweeps the largest other mint into the default mint, over
 * balances keyed by the app's mint spelling.
 */
export const planDefaultMintMove = (
  perMint: ReadonlyArray<{ readonly mint: string; readonly amount: number }>,
  defaultMint: string | null,
): MintMovePlan | null => {
  const toMint = toMintUrl(defaultMint ?? MAIN_MINT_URL);
  if (toMint === null) return null;
  const balances = new Map<MintUrl, number>();
  for (const { amount, mint } of perMint) {
    const key = toMintUrl(mint);
    if (key !== null) balances.set(key, (balances.get(key) ?? 0) + amount);
  }
  return planMintMove({
    toMint,
    balances: Array.from(balances, ([mint, amount]) => ({ mint, amount })),
  });
};

export const makeMoveFundsCommands = ({
  allowTestMints,
  defaultMint,
  linkshu,
  ops,
  rememberSeenMint,
}: {
  readonly allowTestMints: boolean;
  readonly defaultMint: string | null;
  readonly linkshu: Pick<
    LinkshuCommands,
    | "autoswapCashu"
    | "estimateAutoswapCashu"
    | "readWalletBalances"
    | "resolveAutoswapSource"
  >;
  readonly ops: Pick<WalletOps, "runExclusiveTask">;
  readonly rememberSeenMint: (mint: string) => void;
}): MoveFundsCommands => {
  /** `PaymentFailed` at the target means the melt paid and only the claim is left. */
  const claim = async (
    move: MintMove,
  ): Promise<
    | { readonly _tag: "Moved"; readonly receipt: AutoswapReceipt }
    | { readonly _tag: "ClaimPending" }
    | { readonly _tag: "Failed"; readonly detail: string }
  > => {
    try {
      rememberSeenMint(move.targetMint);
      const outcome = await linkshu.autoswapCashu(move);
      if (Result.isSuccess(outcome))
        return { _tag: "Moved", receipt: outcome.success };
      const error = outcome.failure;
      if (
        error._tag === "PaymentFailed" &&
        normalizeMintUrl(error.mint) === normalizeMintUrl(move.targetMint)
      )
        return { _tag: "ClaimPending" };
      return { _tag: "Failed", detail: describeError(error) };
    } catch (error) {
      return { _tag: "Failed", detail: describeError(error) };
    }
  };

  return {
    estimateMintMove: async (move) => {
      try {
        const outcome = await linkshu.estimateAutoswapCashu({
          ...move,
          sourceMint: await linkshu.resolveAutoswapSource(move.sourceMint),
        });
        return Result.isSuccess(outcome)
          ? { _tag: "Estimated", estimate: outcome.success }
          : { _tag: "Failed", detail: describeError(outcome.failure) };
      } catch (error) {
        return { _tag: "Failed", detail: describeError(error) };
      }
    },
    moveMintFunds: async (move, options) => {
      const moved = await ops.runExclusiveTask(() => {
        options?.onStarted?.();
        return claim(move);
      });
      return Option.getOrElse(moved, () => ({ _tag: "Busy" }) as const);
    },
    meltToDefaultMint: async (options) => {
      const targetMint = normalizeMintUrl(defaultMint ?? MAIN_MINT_URL);
      if (!targetMint) return { _tag: "InvalidTarget" };
      const balances = visibleWalletBalances(
        await linkshu.readWalletBalances(),
        allowTestMints,
      );
      const plan = planDefaultMintMove(balances.perMint, defaultMint);
      if (plan === null) return { _tag: "Unavailable" };
      const melted = await ops.runExclusiveTask(
        async (): Promise<MeltToDefaultMintOutcome> => {
          options?.onStarted?.();
          let sourceMint: string;
          try {
            sourceMint = await linkshu.resolveAutoswapSource(plan.fromMint);
          } catch (error) {
            return { _tag: "Failed", detail: describeError(error) };
          }
          const outcome = await claim({ sourceMint, targetMint });
          switch (outcome._tag) {
            case "Moved":
              return {
                _tag: "Moved",
                movedAmount: outcome.receipt.movedAmount,
                targetMint,
              };
            case "ClaimPending":
              return { _tag: "ClaimPending", amount: plan.sourceBalance };
            case "Failed":
              return outcome;
          }
        },
      );
      return Option.getOrElse(melted, () => ({ _tag: "Busy" }) as const);
    },
  };
};

/** Moving funds between mints over the current linkshu runtime. */
export const moveFundsCommandsAtom = Atom.readable((get) =>
  AsyncResult.map(
    AsyncResult.all({
      linkshu: get(linkshuCommandsAtom),
      storage: get(ownerStorageAtom),
    }),
    ({ linkshu, storage }) =>
      makeMoveFundsCommands({
        allowTestMints: get(allowTestMintsAtom),
        defaultMint: get(defaultMintAtom),
        linkshu,
        ops: get(walletOpsAtom),
        rememberSeenMint: storage.rememberSeenMint,
      }),
  ),
);
