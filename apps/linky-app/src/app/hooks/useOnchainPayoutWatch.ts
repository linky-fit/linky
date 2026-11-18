import { NonEmptyString100 } from "@linky-fit/linksync";
import { esploraApiUrl, makeEsploraClient } from "@linky-fit/onchain-transfer";
import { RegistryContext } from "@linky-fit/linkstr-react";
import { Effect } from "effect";
import React from "react";
import { reportAppLog } from "../../devtools/inspector/appLog";
import { checkOnchainPayouts } from "../lib/onchainPayouts";
import { runWrite } from "../lib/storeWrite";
import { onchainTransfersAtom } from "../state/wallet/onchainTransfers";
import { useOnchainConfig } from "./useOnchainTransfers";
import { useOnchainTransfersRepository } from "./useLinksync";

const CHECK_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Looks on chain, now and every 10 minutes, for the payout of each paid send
 * the operator has not completed, and stores the one it finds, which completes
 * the transfer. Run it only while such a send exists.
 */
export const useOnchainPayoutWatch = (): void => {
  const config = useOnchainConfig();
  const explorerUrl =
    config.status === "ready" ? config.config.explorerUrl : null;
  const repository = useOnchainTransfersRepository();
  const registry = React.useContext(RegistryContext);

  React.useEffect(() => {
    if (explorerUrl === null) return;
    const esplora = makeEsploraClient({
      baseUrl: esploraApiUrl(explorerUrl),
      fetch: (url) => globalThis.fetch(url),
    });
    let stopped = false;
    const check = async () => {
      const checks = await Effect.runPromise(
        checkOnchainPayouts(registry.get(onchainTransfersAtom) ?? [], esplora),
      );
      for (const { id, check } of checks) {
        if (stopped) return;
        if (check._tag === "found") {
          const written = await runWrite(
            repository.update(id, {
              payoutTxid: NonEmptyString100.orThrow(check.txid),
            }),
          );
          reportAppLog({
            tag: "onchainTransfer.payoutFound",
            summary: written.ok
              ? `Found the payout of the on-chain send on chain: ${check.txid}`
              : `Found the payout of the on-chain send on chain but could not store it: ${written.error}`,
            links: { onchainTransfer: id },
            payload: { txid: check.txid, stored: written.ok },
          });
        } else {
          reportAppLog({
            tag: "onchainTransfer.payoutChecked",
            summary:
              check._tag === "failed"
                ? `Could not look up the payout address: ${check.message}`
                : "No payout of the on-chain send on chain yet",
            links: { onchainTransfer: id },
            payload: check,
          });
        }
      }
    };
    void check();
    const interval = setInterval(() => void check(), CHECK_INTERVAL_MS);
    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [explorerUrl, registry, repository]);
};
