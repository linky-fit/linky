import type { MintIcon } from "../../utils/mint";
import type { ReceiveMethod } from "../../utils/receiveMethod";
/* eslint-disable react-refresh/only-export-components */
import type { LinkyScope } from "@linky-fit/linksync";
import type {
  AutoswapEstimate,
  OperationId,
  StoredOperation,
  StoredProof,
} from "@linky-fit/linkshu";
import React from "react";
import type { EvoluErrorType, EvoluServerStatus } from "../../evolu";
import type { ShardSummary } from "../hooks/useLinksync";
import type { PendingIdentitySwitch } from "../hooks/useProfileAuthDomain";
import type { IdentityProfileSource } from "../lib/keySwitchProfile";
import type { PasswordManagerSaveResult } from "../../platform/passwordManager";
import type { ProbeLightningFee } from "../hooks/composition/useLinkshuComposition";
import type { MintMove } from "../hooks/mint/useMoveMintFunds";
import type { WriteOutcome } from "../lib/storeWrite";
import type { LocalMintInfoRow } from "../types/appTypes";

export interface AdvancedSettingsContextValue {
  canSwitchToDefaultIdentity: boolean;
  answerPendingIdentitySwitch: (
    source: IdentityProfileSource | null,
  ) => Promise<void>;
  copyNostrKeys: () => Promise<void>;
  copySeed: () => Promise<void>;
  dedupeContacts: () => Promise<void>;
  dedupeContactsIsBusy: boolean;
  defaultMintDisplay: string | null;
  evoluConnectedServerCount: number;
  evoluOverallStatus: EvoluServerStatus;
  evoluServerUrls: string[];
  exportAppData: () => void;
  handleImportAppDataFilePicked: (file: File | null) => Promise<void>;
  importDataFileInputRef: React.RefObject<HTMLInputElement | null>;
  lightningInvoiceAutoPayLimit: number;
  logoutArmed: boolean;
  openScan: () => void;
  payWithCashuEnabled: boolean;
  pendingIdentitySwitch: PendingIdentitySwitch | null;
  pushToast: (message: string) => void;
  receiveMethod: ReceiveMethod;
  relayUrls: string[];
  requestImportAppData: () => void;
  requestLogout: (options: { evoluConnected: boolean }) => void;
  requestPasteNostrKeys: () => Promise<void>;
  saveSeedToPasswordManager: () => Promise<PasswordManagerSaveResult>;
  seedMnemonic: string | null;
  setLightningInvoiceAutoPayLimit: (value: number) => void;
  setPayWithCashuEnabled: (value: boolean) => void;
  setReceiveMethod: (value: ReceiveMethod) => void;
  switchToDefaultIdentity: () => Promise<void>;
}

export interface EvoluSettingsContextValue {
  clearDatabaseArmed: boolean;
  evoluDatabaseBytes: number | null;
  evoluHasError: boolean;
  evoluErrorType: EvoluErrorType | null;
  evoluHistoryCount: number | null;
  evoluServerStatusByUrl: Record<string, EvoluServerStatus>;
  evoluServerUrls: string[];
  evoluServersReloadRequired: boolean;
  /** Every scope's active shard and visible shard set. */
  evoluShards: ReadonlyArray<ShardSummary>;
  /** The owner ids the store syncs: the app owner and every visible shard. */
  evoluSyncOwnerIds: ReadonlyArray<string>;
  evoluTableCounts: Record<string, number | null>;
  evoluWipeStorageIsBusy: boolean;
  isEvoluServerOffline: (url: string) => boolean;
  isEvoluServerRecommended: (url: string) => boolean;
  newEvoluServerUrl: string;
  requestClearDatabase: () => void;
  requestRotateShard: (scope: LinkyScope) => Promise<void>;
  rotatingShardScope: LinkyScope | null;
  saveEvoluServerUrls: (urls: string[]) => void;
  setEvoluServerOffline: (url: string, offline: boolean) => void;
  setNewEvoluServerUrl: (url: string) => void;
  setStatus: (message: string) => void;
  syncOwnerId: string | null;
  wipeEvoluStorage: () => Promise<void>;
}

export interface MintSettingsContextValue {
  allowTestMints: boolean;
  appOwnerIdRef: React.RefObject<string | null>;
  applyDefaultMintSelection: (mint: string) => Promise<boolean>;
  cashuIsBusy: boolean;
  /** Pending `deferredReceive` operations without hidden test mints. */
  cashuDeferredReceives: readonly StoredOperation[];
  cashuMeltToMainMintButtonLabel: string | null;
  /** Stored proofs without hidden test mints. */
  cashuProofs: readonly StoredProof[];
  /** The effective default mint: a hidden test mint falls back to production. */
  defaultMintUrl: string | null;
  /** Closes a pending deferred receive; its token is lost unless copied first. */
  discardCashuDeferredReceive: (id: OperationId) => Promise<void>;
  estimateMintMove: (move: MintMove) => Promise<AutoswapEstimate | null>;
  getMintIconUrl: (mint: string | null | undefined) => MintIcon;
  getMintRuntime: (
    url: string,
  ) => { lastCheckedAtSec: number; latencyMs: number | null } | null;
  meltLargestForeignMintToMainMint: () => Promise<void>;
  mintInfoByUrl: Map<string, LocalMintInfoRow>;
  moveMintFunds: (move: MintMove) => Promise<boolean>;
  /** Null until the linkshu runtime is composed (seed + owners resolved). */
  probeLightningFee: ProbeLightningFee | null;
  refreshMintInfo: (url: string) => Promise<void>;
  setAllowTestMints: (allow: boolean) => Promise<WriteOutcome>;
  setMintInfoAll: React.Dispatch<React.SetStateAction<LocalMintInfoRow[]>>;
  setStatus: (message: string) => void;
}

export interface RelaySettingsContextValue {
  canSaveNewRelay: boolean;
  isRecommendedRelay: (url: string) => boolean;
  newRelayUrl: string;
  pendingRelayDeleteUrl: string | null;
  relayUrls: string[];
  requestDeleteSelectedRelay: () => void;
  saveNewRelay: () => void;
  selectedRelayUrl: string | null;
  setNewRelayUrl: (url: string) => void;
}

interface SystemSettingsContextsProviderProps {
  advancedSettings: AdvancedSettingsContextValue;
  children: React.ReactNode;
  evoluSettings: EvoluSettingsContextValue;
  mintSettings: MintSettingsContextValue;
  relaySettings: RelaySettingsContextValue;
}

const AdvancedSettingsContext =
  React.createContext<AdvancedSettingsContextValue | null>(null);
const EvoluSettingsContext =
  React.createContext<EvoluSettingsContextValue | null>(null);
const MintSettingsContext =
  React.createContext<MintSettingsContextValue | null>(null);
const RelaySettingsContext =
  React.createContext<RelaySettingsContextValue | null>(null);

const useRequiredContext = <T,>(
  contextValue: T | null,
  hookName: string,
): T => {
  if (contextValue === null) {
    throw new Error(
      `${hookName} must be used within SystemSettingsContextsProvider`,
    );
  }

  return contextValue;
};

export const SystemSettingsContextsProvider = ({
  advancedSettings,
  children,
  evoluSettings,
  mintSettings,
  relaySettings,
}: SystemSettingsContextsProviderProps): React.ReactElement => (
  <AdvancedSettingsContext.Provider value={advancedSettings}>
    <EvoluSettingsContext.Provider value={evoluSettings}>
      <MintSettingsContext.Provider value={mintSettings}>
        <RelaySettingsContext.Provider value={relaySettings}>
          {children}
        </RelaySettingsContext.Provider>
      </MintSettingsContext.Provider>
    </EvoluSettingsContext.Provider>
  </AdvancedSettingsContext.Provider>
);

export const useAdvancedSettingsContext = (): AdvancedSettingsContextValue =>
  useRequiredContext(
    React.useContext(AdvancedSettingsContext),
    "useAdvancedSettingsContext",
  );

export const useEvoluSettingsContext = (): EvoluSettingsContextValue =>
  useRequiredContext(
    React.useContext(EvoluSettingsContext),
    "useEvoluSettingsContext",
  );

export const useMintSettingsContext = (): MintSettingsContextValue =>
  useRequiredContext(
    React.useContext(MintSettingsContext),
    "useMintSettingsContext",
  );

export const useRelaySettingsContext = (): RelaySettingsContextValue =>
  useRequiredContext(
    React.useContext(RelaySettingsContext),
    "useRelaySettingsContext",
  );
