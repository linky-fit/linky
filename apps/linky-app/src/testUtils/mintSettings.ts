import {
  LightningFeeProbeResult,
  type AutoswapEstimate,
  type OperationId,
  type StoredOperation,
  type StoredProof,
} from "@linky-fit/linkshu";
import { Result, Schema } from "effect";
import { vi } from "vitest";
import type { ProbeLightningFee } from "../app/hooks/composition/useLinkshuComposition";
import type * as MintInfoHooks from "../app/hooks/mint/useMintInfo";
import type * as Shell from "../app/hooks/shell";
import type { MintMove } from "../app/hooks/mint/useMoveMintFunds";
import type { MintRuntime } from "../app/state/wallet/mintInfo";
import type { WriteOutcome } from "../app/lib/storeWrite";
import type { LocalMintInfoRow } from "../app/types/appTypes";
import type { MintIcon } from "../utils/mint";

export const decodeProbeResult = Schema.decodeUnknownSync(
  LightningFeeProbeResult,
);
export const probeLightningFee = vi.fn<ProbeLightningFee>(
  async ({ mint, probeMint }) =>
    Result.succeed(
      decodeProbeResult({
        mint,
        probeMint,
        amount: 10000,
        feeReserve: 120,
        percent: 1.2,
      }),
    ),
);

/** What the mint screens read through their hooks. */
export interface MintSettings {
  allowTestMints: boolean;
  applyDefaultMintSelection: (mint: string) => Promise<boolean>;
  cashuIsBusy: boolean;
  cashuDeferredReceives: readonly StoredOperation[];
  cashuProofs: readonly StoredProof[];
  defaultMintUrl: string | null;
  deleteMint: (mintUrl: string) => void;
  discardCashuDeferredReceive: (id: OperationId) => Promise<void>;
  estimateMintMove: (move: MintMove) => Promise<AutoswapEstimate | null>;
  getMintIconUrl: (mint: string | null | undefined) => MintIcon;
  getMintRuntime: (url: string) => MintRuntime | null;
  mintInfoByUrl: Map<string, LocalMintInfoRow>;
  moveMintFunds: (move: MintMove) => Promise<boolean>;
  probeLightningFee: ProbeLightningFee | null;
  refreshMintInfo: (url: string) => Promise<void>;
  setAllowTestMints: (allow: boolean) => Promise<WriteOutcome>;
  setStatus: ReturnType<typeof Shell.useSetStatus>;
}

export const createMintSettings = (
  overrides: Partial<MintSettings> = {},
): MintSettings => ({
  allowTestMints: true,
  applyDefaultMintSelection: vi.fn(async () => true),
  cashuIsBusy: false,
  cashuDeferredReceives: [],
  cashuProofs: [],
  defaultMintUrl: "https://cashu.cz",
  deleteMint: vi.fn(),
  discardCashuDeferredReceive: vi.fn(async () => undefined),
  estimateMintMove: vi.fn(async () => null),
  getMintIconUrl: () => ({
    failed: false,
    host: null,
    origin: null,
    url: null,
  }),
  getMintRuntime: () => null,
  mintInfoByUrl: new Map(),
  moveMintFunds: vi.fn(async () => false),
  probeLightningFee,
  refreshMintInfo: async () => {},
  setAllowTestMints: vi.fn<MintSettings["setAllowTestMints"]>(async () => ({
    ok: true,
  })),
  setStatus: vi.fn(),
  ...overrides,
});

type Read = () => MintSettings;

/**
 * `vi.mock` factories for the hook modules the mint screens read, each
 * answering from `read()` at render time so a test can swap the settings.
 */
export const mintSettingsMocks = {
  allowTestMints: (read: Read) => ({
    useAllowTestMints: () => ({
      allowTestMints: read().allowTestMints,
      setAllowTestMints: read().setAllowTestMints,
    }),
  }),
  defaultMint: (read: Read) => ({
    useDefaultMintUrl: () => read().defaultMintUrl,
  }),
  linkshu: (read: Read) => ({
    useLinkshuCommands: () => ({ probeLightningFee: read().probeLightningFee }),
  }),
  mintInfo: (
    read: Read,
  ): Pick<
    typeof MintInfoHooks,
    | "useDeleteMint"
    | "useMintIcons"
    | "useMintInfoByUrl"
    | "useMintRuntime"
    | "useRefreshMintInfo"
  > => ({
    useDeleteMint: () => read().deleteMint,
    useMintIcons: () => ({
      getMintIconUrl: read().getMintIconUrl,
      markMintIconFailed: () => {},
    }),
    useMintInfoByUrl: () => read().mintInfoByUrl,
    useMintRuntime: () => read().getMintRuntime,
    useRefreshMintInfo: () => read().refreshMintInfo,
  }),
  moveMintFunds: (read: Read) => ({
    useMoveMintFunds: () => ({
      estimateMintMove: read().estimateMintMove,
      moveMintFunds: read().moveMintFunds,
    }),
  }),
  npubCash: (read: Read) => ({
    useApplyDefaultMint: () => read().applyDefaultMintSelection,
  }),
  walletInventory: (read: Read) => ({
    useWalletInventory: () => ({
      deferredReceives: read().cashuDeferredReceives,
      proofs: read().cashuProofs,
    }),
  }),
  walletOps: (read: Read) => ({
    useWalletOps: () => ({ walletOpRunning: read().cashuIsBusy }),
  }),
  walletTokens: (read: Read) => ({
    useWalletTokens: () => ({
      discardCashuDeferredReceive: read().discardCashuDeferredReceive,
    }),
  }),
};
