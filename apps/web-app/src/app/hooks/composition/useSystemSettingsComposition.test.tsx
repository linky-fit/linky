import type { OwnerId } from "@evolu/common";
import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import type {
  AdvancedSettingsContextValue,
  EvoluSettingsContextValue,
  MintSettingsContextValue,
  RelaySettingsContextValue,
} from "../../context/SystemSettingsContexts";
import {
  useSystemSettingsComposition,
  type SystemSettingsCompositionResult,
} from "./useSystemSettingsComposition";

const noop = (): void => {};
const noopAsync = async (): Promise<void> => {};
const translate = (key: string): string => key;

const createAdvancedSettings = (
  pushToast: (message: string) => void,
): AdvancedSettingsContextValue => ({
  copyNostrKeys: noopAsync,
  copySeed: noopAsync,
  dedupeContacts: noopAsync,
  dedupeContactsIsBusy: false,
  defaultMintDisplay: null,
  evoluConnectedServerCount: 0,
  evoluOverallStatus: "checking",
  evoluServerUrls: [],
  exportAppData: noop,
  handleImportAppDataFilePicked: noopAsync,
  importDataFileInputRef: React.createRef<HTMLInputElement>(),
  lightningInvoiceAutoPayLimit: 1,
  logoutArmed: false,
  passwordManagerSeedUsername: "",
  payWithCashuEnabled: true,
  pushToast,
  relayUrls: [],
  requestImportAppData: noop,
  requestLogout: noop,
  requestPasteNostrKeys: noopAsync,
  saveSeedToPasswordManager: async () => "saved",
  seedMnemonic: null,
  setLightningInvoiceAutoPayLimit: noop,
  setPayWithCashuEnabled: noop,
});

type EvoluSettingsInput = Omit<
  EvoluSettingsContextValue,
  "clearDatabaseArmed" | "requestClearDatabase"
>;

const createEvoluSettings = (
  wipeEvoluStorage: () => Promise<void>,
): EvoluSettingsInput => ({
  evoluCashuOwnerEditsUntilRotation: 0,
  evoluCashuOwnerId: null,
  evoluCashuOwnerIndex: 0,
  evoluCashuVisibleOwnerIds: [],
  evoluContactsOwnerEditCount: 0,
  evoluContactsOwnerEditsUntilRotation: 0,
  evoluContactsOwnerId: null,
  evoluContactsOwnerIndex: 0,
  evoluContactsOwnerNewContactsCount: 0,
  evoluContactsOwnerPointer: "",
  evoluDatabaseBytes: null,
  evoluHasError: false,
  evoluErrorType: null,
  evoluHistoryAllowedOwnerIds: [],
  evoluHistoryCount: null,
  evoluMessagesOwnerEditsUntilRotation: 0,
  evoluMessagesOwnerId: null,
  evoluMessagesOwnerIndex: 0,
  evoluMessagesVisibleOwnerIds: [],
  evoluServerStatusByUrl: {},
  evoluServerUrls: [],
  evoluServersReloadRequired: false,
  evoluTableCounts: {},
  evoluTransactionsOwnerEditsUntilRotation: 0,
  evoluTransactionsOwnerId: null,
  evoluTransactionsOwnerIndex: 0,
  evoluTransactionsOwnerPointer: "",
  evoluTransactionsVisibleOwnerIds: [],
  evoluWipeStorageIsBusy: false,
  isEvoluServerOffline: () => false,
  newEvoluServerUrl: "",
  pendingEvoluServerDeleteUrl: null,
  requestManualRotateCashuOwner: noopAsync,
  requestManualRotateContactsOwner: noopAsync,
  requestManualRotateMessagesOwner: noopAsync,
  requestManualRotateTransactionsOwner: noopAsync,
  rotateCashuOwnerIsBusy: false,
  rotateContactsOwnerIsBusy: false,
  rotateMessagesOwnerIsBusy: false,
  rotateTransactionsOwnerIsBusy: false,
  saveEvoluServerUrls: noop,
  setEvoluServerOffline: noop,
  setNewEvoluServerUrl: noop,
  setPendingEvoluServerDeleteUrl: noop,
  setStatus: noop,
  syncOwner: null,
  wipeEvoluStorage,
});

const appOwnerIdRef = React.createRef<OwnerId>();

const mintSettings: MintSettingsContextValue = {
  appOwnerIdRef,
  applyDefaultMintSelection: noopAsync,
  cashuIsBusy: false,
  cashuMeltToMainMintButtonLabel: null,
  defaultMintUrl: null,
  defaultMintUrlDraft: "",
  getMintIconUrl: () => ({
    failed: false,
    host: null,
    origin: null,
    url: null,
  }),
  getMintRuntime: () => null,
  meltLargestForeignMintToMainMint: noopAsync,
  mintInfoByUrl: new Map(),
  pendingMintDeleteUrl: null,
  probeLightningFee: null,
  refreshMintInfo: noopAsync,
  setDefaultMintUrlDraft: noop,
  setMintInfoAll: noop,
  setPendingMintDeleteUrl: noop,
  setStatus: noop,
};

const relaySettings: RelaySettingsContextValue = {
  canSaveNewRelay: false,
  newRelayUrl: "",
  pendingRelayDeleteUrl: null,
  relayUrls: [],
  requestDeleteSelectedRelay: noop,
  saveNewRelay: noop,
  selectedRelayUrl: null,
  setNewRelayUrl: noop,
};

interface HarnessProps {
  advancedSettingsInput: AdvancedSettingsContextValue;
  evoluSettingsInput: EvoluSettingsInput;
  resultRef: React.RefObject<SystemSettingsCompositionResult | null>;
}

const Harness = ({
  advancedSettingsInput,
  evoluSettingsInput,
  resultRef,
}: HarnessProps): null => {
  const result = useSystemSettingsComposition({
    advancedSettingsInput,
    evoluSettingsInput,
    mintSettingsInput: mintSettings,
    relaySettingsInput: relaySettings,
    t: translate,
  });
  React.useEffect(() => {
    resultRef.current = result;
  }, [result, resultRef]);
  return null;
};

const readResult = (
  resultRef: React.RefObject<SystemSettingsCompositionResult | null>,
): SystemSettingsCompositionResult => {
  if (resultRef.current === null) {
    throw new Error("system settings composition result missing");
  }
  return resultRef.current;
};

describe("useSystemSettingsComposition", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("arms, confirms, and times out database clearing", async () => {
    vi.useFakeTimers();
    const pushToast = vi.fn();
    const wipeEvoluStorage = vi.fn(noopAsync);
    const advancedSettingsInput = createAdvancedSettings(pushToast);
    const evoluSettingsInput = createEvoluSettings(wipeEvoluStorage);
    const resultRef = React.createRef<SystemSettingsCompositionResult | null>();

    const { root } = await renderIntoDocument(
      <Harness
        advancedSettingsInput={advancedSettingsInput}
        evoluSettingsInput={evoluSettingsInput}
        resultRef={resultRef}
      />,
    );

    act(() => {
      readResult(resultRef).evoluSettingsContext.requestClearDatabase();
    });
    expect(readResult(resultRef).evoluSettingsContext.clearDatabaseArmed).toBe(
      true,
    );
    expect(pushToast).toHaveBeenCalledWith("deleteArmedHint");
    expect(wipeEvoluStorage).not.toHaveBeenCalled();

    act(() => {
      readResult(resultRef).evoluSettingsContext.requestClearDatabase();
    });
    expect(readResult(resultRef).evoluSettingsContext.clearDatabaseArmed).toBe(
      false,
    );
    expect(wipeEvoluStorage).toHaveBeenCalledTimes(1);

    act(() => {
      readResult(resultRef).evoluSettingsContext.requestClearDatabase();
    });
    expect(readResult(resultRef).evoluSettingsContext.clearDatabaseArmed).toBe(
      true,
    );

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(readResult(resultRef).evoluSettingsContext.clearDatabaseArmed).toBe(
      false,
    );

    await act(async () => {
      root.unmount();
    });
  });
});
