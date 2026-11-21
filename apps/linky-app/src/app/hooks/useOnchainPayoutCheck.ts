import { RegistryContext } from "@linky-fit/linkstr-react";
import { esploraApiUrl, makeEsploraClient } from "@linky-fit/onchain-transfer";
import { Effect } from "effect";
import React from "react";
import { reportAppLog } from "../../devtools/inspector/appLog";
import { checkOnchainPayouts } from "../lib/onchainPayouts";
import { runWrite } from "../lib/storeWrite";
import { onchainTransfersAtom } from "../state/wallet/onchainTransfers";
import { useOnchainTransfersRepository } from "./useLinksync";

/**
 * Looks on chain for the payout of the paid sends to `payoutAddress` the
 * operator has not completed, and stores the one it finds, which completes
 * the transfer. Call it only when the user opens the address in the explorer
 * themselves, so the explorer learns their IP address by their own action.
 */
export const useOnchainPayoutCheck = (): ((
  payoutAddress: string,
  explorerUrl: string,
) => void) => {
  const registry = React.useContext(RegistryContext);
  const repository = useOnchainTransfersRepository();
  return React.useCallback(
    (payoutAddress, explorerUrl) => {
      const esplora = makeEsploraClient({
        baseUrl: esploraApiUrl(explorerUrl),
        fetch: (url) => globalThis.fetch(url),
      });
      void (async () => {
        const checks = await Effect.runPromise(
          checkOnchainPayouts(
            registry.get(onchainTransfersAtom) ?? [],
            payoutAddress,
            esplora,
          ),
        );
        for (const { id, check } of checks) {
          if (check._tag !== "found") {
            reportAppLog({
              tag: "onchainTransfer.payoutChecked",
              summary:
                check._tag === "failed"
                  ? `Could not look up the payout address: ${check.message}`
                  : "No payout of the on-chain send on chain yet",
              links: { onchainTransfer: id },
              payload: check,
            });
            continue;
          }
          const written = await runWrite(
            repository.update(id, {
              payoutTxid: check.txid,
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
        }
      })();
    },
    [registry, repository],
  );
};
