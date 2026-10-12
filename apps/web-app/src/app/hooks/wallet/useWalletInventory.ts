import { useAtomValue } from "@linky-fit/linkstr-react";
import { Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import React from "react";
import {
  formatMintHost,
  MAIN_MINT_URL,
  normalizeMintUrl,
} from "../../../utils/mint";
import {
  isShownDeferredReceive,
  sentTokenClaims,
  takenTokenTexts,
} from "../../lib/cashuTransfers";
import { getCashuTokenMessageInfo } from "../../lib/tokenMessageInfo";
import {
  visibleWalletBalances,
  withoutHiddenTestMints,
} from "../../lib/testMintGate";
import {
  emptyReadModel,
  walletReadModelAtom,
} from "../../state/linkshu/readModel";
import { allowTestMintsAtom } from "../../state/session/settings";
import { defaultMintAtom } from "../../state/wallet/defaultMint";
import { planDefaultMintMove } from "../../state/wallet/moveFunds";
import { walletOpRunningAtom } from "../../state/wallet/opQueue";
import { useTranslation } from "../shell";

/** The wallet inventory read model, with test mints hidden unless allowed. */
export const useWalletInventory = () => {
  const allowTestMints = useAtomValue(allowTestMintsAtom);
  const readModel = Option.getOrNull(
    AsyncResult.value(useAtomValue(walletReadModelAtom)),
  );
  const model = readModel ?? emptyReadModel;

  const balances = React.useMemo(
    () => visibleWalletBalances(model.balances, allowTestMints),
    [allowTestMints, model.balances],
  );
  const proofs = React.useMemo(
    () => withoutHiddenTestMints(model.proofs, allowTestMints),
    [allowTestMints, model.proofs],
  );
  const deferredReceives = React.useMemo(
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
    /** Every stored proof, test mints included; backups must not lose hidden funds. */
    allProofs: model.proofs,
    balances,
    /** Sat tokens kept for an unreachable mint, without hidden test mints. */
    deferredReceives,
    /** True once the first inventory read answered; false shows as an empty wallet. */
    loaded: readModel !== null,
    operations: model.operations,
    proofs,
    transfers: model.transfers,
  };
};

/** What the wallet can spend, and whether a move into the default mint would cover more. */
export const useWalletBalance = () => {
  const { t } = useTranslation();
  const { balances } = useWalletInventory();
  const defaultMintUrl = useAtomValue(defaultMintAtom);
  const walletOpRunning = useAtomValue(walletOpRunningAtom);

  const paymentMintMeltPlan = React.useMemo(
    () => planDefaultMintMove(balances.perMint, defaultMintUrl),
    [balances.perMint, defaultMintUrl],
  );
  const mainMint = normalizeMintUrl(defaultMintUrl ?? MAIN_MINT_URL);
  const cashuBalance: number = balances.spendable;
  const cashuTotalBalance: number = balances.total;

  return {
    canPayWithCashu: cashuBalance > 0,
    cashuBalance,
    cashuBalanceAfterMelt: Math.max(
      cashuBalance,
      paymentMintMeltPlan?.maxBalanceAfterMove ?? 0,
    ),
    cashuHasMultipleAcceptedMints:
      new Set(balances.perMint.map(({ mint }) => normalizeMintUrl(mint))).size >
      1,
    cashuIsBusy: walletOpRunning,
    cashuMeltToMainMintButtonLabel:
      mainMint && paymentMintMeltPlan
        ? t("cashuMeltToMainMint").replace("{mint}", formatMintHost(mainMint))
        : null,
    cashuTotalBalance,
    mintBalances: balances.perMint,
  };
};

/** What a token in a message is worth and what the wallet knows about it. */
export const useCashuTokenMessageInfo = () => {
  const allowTestMints = useAtomValue(allowTestMintsAtom);
  const { allProofs, operations, transfers } = useWalletInventory();
  const knownTransferTexts = React.useMemo(
    () => takenTokenTexts(transfers, operations),
    [operations, transfers],
  );
  const sentClaims = React.useMemo(
    () => sentTokenClaims(transfers, allProofs),
    [allProofs, transfers],
  );
  return React.useCallback(
    (text: string) =>
      getCashuTokenMessageInfo(
        text,
        knownTransferTexts,
        allowTestMints,
        sentClaims,
      ),
    [allowTestMints, knownTransferTexts, sentClaims],
  );
};
