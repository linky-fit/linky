import {
  deriveAccountAddress,
  parseDepositXpub,
  type BitcoinNetwork,
  type EsploraClient,
} from "@linky-fit/onchain-transfer";
import { Effect } from "effect";
import type { OperatorProfile } from "../domain/profile";
import { nextAddressIndex } from "../domain/rules";
import { scanOnchainWallet } from "../domain/onchainWallet";
import type { OperatorTransfer } from "../domain/transfer";

export interface OnchainWallet {
  /** The confirmed sats of the profile's Taproot account as Esplora shows them; `null` without a key of this network. Watch-only, it cannot spend. */
  readonly balance: () => Promise<number | null>;
}

export const createOnchainWallet = ({
  esplora,
  network,
  loadProfile,
  loadTransfers,
}: {
  readonly esplora: EsploraClient;
  readonly network: BitcoinNetwork;
  readonly loadProfile: () => Promise<OperatorProfile | null>;
  readonly loadTransfers: () => Promise<readonly OperatorTransfer[]>;
}): OnchainWallet => ({
  balance: async () => {
    const profile = await loadProfile();
    const xpub =
      profile === null ? null : parseDepositXpub(profile.xpub, network);
    if (xpub === null) return null;
    return Effect.runPromise(
      scanOnchainWallet({
        addressAt: (chain, index) =>
          deriveAccountAddress({ xpub, chain, index, network }),
        receiveFrom: nextAddressIndex(await loadTransfers()),
        esplora,
      }),
    );
  },
});
