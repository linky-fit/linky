import type { ReceiveMethod } from "../../utils/receiveMethod";
/* eslint-disable react-refresh/only-export-components */
import type { LinkyScope } from "@linky-fit/linksync";
import React from "react";
import type { EvoluErrorType, EvoluServerStatus } from "../../evolu";
import type { ShardSummary } from "../hooks/useLinksync";
import type { PendingIdentitySwitch } from "../hooks/useProfileAuthDomain";
import type { IdentityProfileSource } from "../lib/keySwitchProfile";
import type { PasswordManagerSaveResult } from "../../platform/passwordManager";

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
  relaySettings: RelaySettingsContextValue;
}

const AdvancedSettingsContext =
  React.createContext<AdvancedSettingsContextValue | null>(null);
const EvoluSettingsContext =
  React.createContext<EvoluSettingsContextValue | null>(null);
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
  relaySettings,
}: SystemSettingsContextsProviderProps): React.ReactElement => (
  <AdvancedSettingsContext.Provider value={advancedSettings}>
    <EvoluSettingsContext.Provider value={evoluSettings}>
      <RelaySettingsContext.Provider value={relaySettings}>
        {children}
      </RelaySettingsContext.Provider>
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

export const useRelaySettingsContext = (): RelaySettingsContextValue =>
  useRequiredContext(
    React.useContext(RelaySettingsContext),
    "useRelaySettingsContext",
  );
