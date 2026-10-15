import type { Pubkey } from "@linky-fit/linkstr";
import React from "react";
import {
  startNativeBeaconIdentityScan,
  stopNativeBeaconIdentityScan,
  type BeaconPermissionState,
  type NativeBeaconStatus,
} from "../../platform/nativeBridge";
import type { BeaconState } from "../lib/beaconCodec";
import type { BeaconTrade } from "../lib/beaconSettings";
import {
  clearBeaconIdentities,
  getBeaconSnapshot,
  markBeaconIntroSeen,
  requestBeaconPermissions,
  setBeaconEnabled,
  setBeaconTrade,
  subscribeBeacon,
  type BeaconSnapshot,
  type NearbyContact,
} from "../lib/beaconStore";
import { useExperimentalFeatures } from "./useExperimentalFeatures";

const useBeaconSnapshot = <A>(select: (snapshot: BeaconSnapshot) => A): A =>
  React.useSyncExternalStore(subscribeBeacon, () =>
    select(getBeaconSnapshot()),
  );

const selectPermission = (snapshot: BeaconSnapshot) => snapshot.permission;

/** Experimental features on and a native shell whose device can advertise; the web reports `unsupported`. */
export const useBeaconSupport = (): boolean => {
  const { experimentalFeatures } = useExperimentalFeatures();
  const permission = useBeaconSnapshot(selectPermission);
  return experimentalFeatures && permission !== "unsupported";
};

const setEnabled = async (enabled: boolean): Promise<void> => {
  setBeaconEnabled(enabled);
  if (enabled && getBeaconSnapshot().permission !== "granted")
    await requestBeaconPermissions();
};

const requestPermissions = (): void => {
  void requestBeaconPermissions();
};

export interface UseBeacon {
  readonly enabled: boolean;
  /** `true` asks for the Bluetooth permissions when needed; the service starts once they are granted. */
  readonly setEnabled: (enabled: boolean) => Promise<void>;
  readonly trade: BeaconTrade;
  readonly setTrade: (trade: BeaconTrade) => void;
  readonly permission: BeaconPermissionState;
  readonly requestPermissions: () => void;
  readonly status: NativeBeaconStatus;
  readonly introSeen: boolean;
  readonly markIntroSeen: () => void;
  readonly keyCount: number;
}

export const useBeacon = (): UseBeacon => {
  const snapshot = useBeaconSnapshot((current) => current);
  return {
    enabled: snapshot.enabled,
    setEnabled,
    trade: snapshot.trade,
    setTrade: setBeaconTrade,
    permission: snapshot.permission,
    requestPermissions,
    status: snapshot.status,
    introSeen: snapshot.introSeen,
    markIntroSeen: markBeaconIntroSeen,
    keyCount: snapshot.keyCount,
  };
};

const selectNearbyContacts = (snapshot: BeaconSnapshot) =>
  snapshot.nearbyContacts;

export const useNearbyContacts = (): ReadonlyArray<NearbyContact> =>
  useBeaconSnapshot(selectNearbyContacts);

export const useNearbyContact = (pubkey: Pubkey | null): BeaconState | null =>
  useBeaconSnapshot(
    (snapshot) =>
      snapshot.nearbyContacts.find((contact) => contact.pubkey === pubkey)
        ?.state ?? null,
  );

const selectNearbyIdentities = (snapshot: BeaconSnapshot) =>
  snapshot.nearbyIdentities;

/** Npubs seen by the identity scan that are not contacts yet. */
export const useNearbyIdentities = (): ReadonlyArray<Pubkey> =>
  useBeaconSnapshot(selectNearbyIdentities);

const selectCanScan = (snapshot: BeaconSnapshot) =>
  snapshot.supported && snapshot.permission === "granted";

/** Scans for identity packets while mounted, the beacon is supported and the Bluetooth permissions are granted. */
export const useIdentityScan = (): void => {
  const canScan = useBeaconSnapshot(selectCanScan);
  React.useEffect(() => {
    if (!canScan) return;
    startNativeBeaconIdentityScan();
    return () => {
      stopNativeBeaconIdentityScan();
      clearBeaconIdentities();
    };
  }, [canScan]);
};
