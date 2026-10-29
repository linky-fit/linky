import { useAtomValue } from "@linky-fit/linkstr-react";
import { Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import { linkshuCommandsAtom } from "../../state/linkshu/commands";
import { useWalletInventory } from "../wallet/useWalletInventory";

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
  FetchMintInfo,
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

/** The linkshu commands, null until the runtime is up. */
export const useLinkshuCommands = () =>
  Option.getOrNull(AsyncResult.value(useAtomValue(linkshuCommandsAtom)));

/**
 * The wallet UI's view of linkshu: the commands, null until the runtime is
 * up, and the inventory read model with test mints hidden as configured.
 */
export const useLinkshuComposition = () => {
  const commands = useLinkshuCommands();
  const inventory = useWalletInventory();

  return {
    adoptPaidCashuQuote: commands?.adoptPaidCashuQuote ?? null,
    allWalletProofs: inventory.allProofs,
    autoswapCashu: commands?.autoswapCashu ?? null,
    cashuEnvelopes: commands?.cashuEnvelopes ?? null,
    cashuTransferLifecycle: commands?.cashuTransferLifecycle ?? null,
    checkAllCashuTokens: commands?.checkAllCashuTokens ?? null,
    inspectCashuProofStates: commands?.inspectCashuProofStates ?? null,
    checkCashuTransfer: commands?.checkCashuTransfer ?? null,
    estimateAutoswapCashu: commands?.estimateAutoswapCashu ?? null,
    fetchMintInfo: commands?.fetchMintInfo ?? null,
    meltCashuInvoice: commands?.meltCashuInvoice ?? null,
    probeLightningFee: commands?.probeLightningFee ?? null,
    quoteCashuMelt: commands?.quoteCashuMelt ?? null,
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
    walletBalances: inventory.balances,
    walletDeferredReceives: inventory.deferredReceives,
    walletLoaded: inventory.loaded,
    walletOperations: inventory.operations,
    walletProofs: inventory.proofs,
    walletTransfers: inventory.transfers,
  };
};
