import { LightningFeeProbeResult } from "@linky/linkshu";
import { Either, Schema } from "effect";
import React from "react";
import { vi } from "vitest";
import type { MintSettingsContextValue } from "../app/context/SystemSettingsContexts";
import type { ProbeLightningFee } from "../app/hooks/composition/useLinkshuComposition";

export const decodeProbeResult = Schema.decodeUnknownSync(
  LightningFeeProbeResult,
);
export const probeLightningFee = vi.fn<ProbeLightningFee>(
  async ({ mint, probeMint }) =>
    Either.right(
      decodeProbeResult({
        mint,
        probeMint,
        amount: 10000,
        feeReserve: 120,
        percent: 1.2,
      }),
    ),
);

const appOwnerIdRef = React.createRef<string>();

export const createMintSettings = (
  overrides: Partial<MintSettingsContextValue> = {},
): MintSettingsContextValue => ({
  allowTestMints: true,
  appOwnerIdRef,
  applyDefaultMintSelection: vi.fn(async () => true),
  cashuIsBusy: false,
  cashuMeltToMainMintButtonLabel: "Melt foreign balance",
  cashuProofs: [],
  defaultMintUrl: "https://cashu.cz",
  estimateMintMove: vi.fn(async () => null),
  getMintIconUrl: () => ({
    failed: false,
    host: null,
    origin: null,
    url: null,
  }),
  getMintRuntime: () => null,
  meltLargestForeignMintToMainMint: vi.fn(async () => {}),
  mintInfoByUrl: new Map(),
  moveMintFunds: vi.fn(async () => false),
  pendingMintDeleteUrl: null,
  probeLightningFee,
  refreshMintInfo: async () => {},
  setAllowTestMints: vi.fn<MintSettingsContextValue["setAllowTestMints"]>(
    async () => ({ ok: true }),
  ),
  setMintInfoAll: vi.fn(),
  setPendingMintDeleteUrl: vi.fn(),
  setStatus: vi.fn(),
  ...overrides,
});
