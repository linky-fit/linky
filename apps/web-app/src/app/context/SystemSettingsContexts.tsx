import type { MintIcon } from "../../utils/mint";
/* eslint-disable react-refresh/only-export-components */
import type { LinkyScope } from "@linky/linksync";
import React from "react";
import type { EvoluErrorType, EvoluServerStatus } from "../../evolu";
import type { ShardSummary } from "../hooks/useLinksync";
import type { PasswordManagerSaveResult } from "../../platform/passwordManager";
import type { ProbeLightningFee } from "../hooks/composition/useLinkshuComposition";
import type { LocalMintInfoRow } from "../types/appTypes";

export interface AdvancedSettingsContextValue {
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
  payWithCashuEnabled: boolean;
  pushToast: (message: string) => void;
  relayUrls: string[];
  requestImportAppData: () => void;
  requestLogout: () => void;
  requestPasteNostrKeys: () => Promise<void>;
  saveSeedToPasswordManager: () => Promise<PasswordManagerSaveResult>;
  seedMnemonic: string | null;
  setLightningInvoiceAutoPayLimit: (value: number) => void;
  setPayWithCashuEnabled: (value: boolean) => void;
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
  newEvoluServerUrl: string;
  pendingEvoluServerDeleteUrl: string | null;
  requestClearDatabase: () => void;
  requestRotateShard: (scope: LinkyScope) => Promise<void>;
  rotatingShardScope: LinkyScope | null;
  saveEvoluServerUrls: (urls: string[]) => void;
  setEvoluServerOffline: (url: string, offline: boolean) => void;
  setNewEvoluServerUrl: (url: string) => void;
  setPendingEvoluServerDeleteUrl: (url: string | null) => void;
  setStatus: (message: string) => void;
  syncOwnerId: string | null;
  wipeEvoluStorage: () => Promise<void>;
}

export interface MintSettingsContextValue {
  appOwnerIdRef: React.RefObject<string | null>;
  applyDefaultMintSelection: (mint: string) => Promise<void>;
  cashuIsBusy: boolean;
  cashuMeltToMainMintButtonLabel: string | null;
  defaultMintUrl: string | null;
  defaultMintUrlDraft: string;
  getMintIconUrl: (mint: string | null | undefined) => MintIcon;
  getMintRuntime: (
    url: string,
  ) => { lastCheckedAtSec: number; latencyMs: number | null } | null;
  meltLargestForeignMintToMainMint: () => Promise<void>;
  mintInfoByUrl: Map<string, LocalMintInfoRow>;
  pendingMintDeleteUrl: string | null;
  /** Null until the linkshu runtime is composed (seed + owners resolved). */
  probeLightningFee: ProbeLightningFee | null;
  refreshMintInfo: (url: string) => Promise<void>;
  setDefaultMintUrlDraft: (value: string) => void;
  setMintInfoAll: React.Dispatch<React.SetStateAction<LocalMintInfoRow[]>>;
  setPendingMintDeleteUrl: (url: string | null) => void;
  setStatus: (message: string) => void;
}

export interface RelaySettingsContextValue {
  canSaveNewRelay: boolean;
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
