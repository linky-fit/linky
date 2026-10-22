import { createId, type OnchainTransferId } from "@linky-fit/linksync";
import {
  DEFAULT_TRANSFER_AMOUNTS,
  type OnchainConfig,
  type OnchainTransferUpdate,
} from "@linky-fit/onchain-transfer";
import type { OnchainTransferView } from "../app/lib/onchainTransfers";
import type { DisplayCurrency, FiatRates } from "../utils/displayAmounts";

/** P2WPKH addresses of the BIP-173 test key, valid on regtest and on mainnet only. */
export const REGTEST_ADDRESS = "bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080";
export const MAINNET_ADDRESS = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
export const TXID = "ab".repeat(32);

/** Euro display at 100,000 EUR per bitcoin, so 100,000 sat shows as ~100 EUR. */
export const EUR_DISPLAY: {
  displayCurrency: DisplayCurrency;
  fiatRates: FiatRates;
} = {
  displayCurrency: "eur",
  fiatRates: {
    brlPerBtc: 500_000,
    chfPerBtc: 90_000,
    czkPerBtc: 2_500_000,
    eurPerBtc: 100_000,
    fetchedAtMs: 1_700_000_000_000,
    usdPerBtc: 110_000,
  },
};

export const onchainConfigFixture = (
  overrides: Partial<OnchainConfig> = {},
): OnchainConfig => ({
  v: 1,
  feeBasisPoints: 100,
  paused: false,
  description: "Transfers by hand.",
  amounts: DEFAULT_TRANSFER_AMOUNTS,
  mintUrl: "https://mint.example",
  network: "regtest",
  explorerUrl: "https://explorer.example",
  ...overrides,
});

export const onchainTransferUpdateFixture = (
  transferId: OnchainTransferId,
  overrides: Partial<OnchainTransferUpdate> = {},
): OnchainTransferUpdate => ({
  v: 1,
  type: "update",
  transferId,
  revision: 1,
  status: "accepted",
  fee: 1_000,
  sendAmount: 101_000,
  ...overrides,
});

export const onchainTransferViewFixture = (
  overrides: Partial<OnchainTransferView> = {},
): OnchainTransferView => ({
  id: createId<"OnchainTransfer">(),
  createdAtSec: 1_700_000_000,
  direction: "send",
  amount: 100_000,
  fee: 1_000,
  sendAmount: 101_000,
  phase: "waitingForDetails",
  update: null,
  payoutAddress: REGTEST_ADDRESS,
  refundAddress: null,
  refundToSender: false,
  depositAddress: null,
  operatorPaymentRequest: null,
  ...overrides,
});
