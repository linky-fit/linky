import { useAtomValue } from "@linky-fit/linkstr-react";
import { Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import React from "react";
import { isShownDeferredReceive } from "../../lib/cashuTransfers";
import {
  visibleWalletBalances,
  withoutHiddenTestMints,
} from "../../lib/testMintGate";
import { linkshuCommandsAtom } from "../../state/linkshu/commands";
import {
  emptyReadModel,
  walletReadModelAtom,
} from "../../state/linkshu/readModel";

export type {
  AdoptPaidCashuQuote,
  AdoptPaidCashuQuoteArgs,
  AutoswapCashu,
  CashuEnvelopeRef,
  CashuEnvelopes,
  CashuTopupHandle,
  CashuTransferLifecycle,
  CheckAllCashuTokens,
  CheckCashuTransfer,
  EstimateAutoswapCashu,
  InspectCashuProofStates,
  MeltCashuInvoice,
  ProbeLightningFee,
  ReceiveCashuToken,
  ReclaimCashuTokens,
  ResolveAutoswapSource,
  RestoreCashuTokens,
  ResumeDeferredCashuReceives,
  ResumePendingCashuMelts,
  ResumePendingCashuTopups,
  SendCashuToken,
  StartCashuTopup,
} from "../../state/linkshu/commands";

interface UseLinkshuCompositionParams {
  /** Off: test-mint proofs are left out of `walletBalances` and `walletProofs`. */
  allowTestMints: boolean;
}

/**
 * The wallet UI's view of linkshu: the commands, null until the runtime is
 * up, and the inventory read model with test mints hidden as configured.
 */
export const useLinkshuComposition = ({
  allowTestMints,
}: UseLinkshuCompositionParams) => {
  const commands = Option.getOrNull(
    AsyncResult.value(useAtomValue(linkshuCommandsAtom)),
  );
  const readModel = Option.getOrNull(
    AsyncResult.value(useAtomValue(walletReadModelAtom)),
  );
  const model = readModel ?? emptyReadModel;

  const walletBalances = React.useMemo(
    () => visibleWalletBalances(model.balances, allowTestMints),
    [allowTestMints, model.balances],
  );
  const walletProofs = React.useMemo(
    () => withoutHiddenTestMints(model.proofs, allowTestMints),
    [allowTestMints, model.proofs],
  );
  const walletDeferredReceives = React.useMemo(
    () =>
      withoutHiddenTestMints(
        // Linky is sat-only: a non-sat deferral is neither shown nor
        // discardable here, yet it still keeps its mint known.
        model.operations.filter(isShownDeferredReceive),
        allowTestMints,
      ),
    [allowTestMints, model.operations],
  );

  return {
    adoptPaidCashuQuote: commands?.adoptPaidCashuQuote ?? null,
    /** Every stored proof, test mints included; backups must not lose hidden funds. */
    allWalletProofs: model.proofs,
    autoswapCashu: commands?.autoswapCashu ?? null,
    cashuEnvelopes: commands?.cashuEnvelopes ?? null,
    cashuTransferLifecycle: commands?.cashuTransferLifecycle ?? null,
    checkAllCashuTokens: commands?.checkAllCashuTokens ?? null,
    inspectCashuProofStates: commands?.inspectCashuProofStates ?? null,
    checkCashuTransfer: commands?.checkCashuTransfer ?? null,
    estimateAutoswapCashu: commands?.estimateAutoswapCashu ?? null,
    meltCashuInvoice: commands?.meltCashuInvoice ?? null,
    probeLightningFee: commands?.probeLightningFee ?? null,
    receiveCashuToken: commands?.receiveCashuToken ?? null,
    restoreCashuTokens: commands?.restoreCashuTokens ?? null,
    reclaimCashuTokens: commands?.reclaimCashuTokens ?? null,
    resolveAutoswapSource: commands?.resolveAutoswapSource ?? null,
    resumeDeferredCashuReceives: commands?.resumeDeferredCashuReceives ?? null,
    resumePendingCashuAutoswapClaims:
      commands?.resumePendingCashuAutoswapClaims ?? null,
    resumePendingCashuMelts: commands?.resumePendingCashuMelts ?? null,
    resumePendingCashuTopups: commands?.resumePendingCashuTopups ?? null,
    sendCashuToken: commands?.sendCashuToken ?? null,
    startCashuTopup: commands?.startCashuTopup ?? null,
    walletBalances,
    /** Sat tokens kept for an unreachable mint, without hidden test mints. */
    walletDeferredReceives,
    /** True once the first inventory read answered; false shows as an empty wallet. */
    walletLoaded: readModel !== null,
    walletOperations: model.operations,
    walletProofs,
    walletTransfers: model.transfers,
  };
};
