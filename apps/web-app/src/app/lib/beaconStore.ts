import type { Pubkey } from "@linky-fit/linkstr";
import type { ContactId } from "@linky-fit/linksync";
import { reportAppLog } from "../../devtools/inspector/appLog";
import {
  getNativeBeaconPermissionState,
  onNativeBeaconIdentities,
  onNativeBeaconNearby,
  onNativeBeaconOpenConversation,
  onNativeBeaconPermission,
  onNativeBeaconStatus,
  requestNativeBeaconPermissions,
  setNativeBeaconIdentity,
  setNativeBeaconKeys,
  setNativeBeaconTrade,
  startNativeBeacon,
  stopNativeBeacon,
  takeNativeBeaconStoppedByUser,
  type BeaconPermissionState,
  type NativeBeaconKey,
  type NativeBeaconSighting,
  type NativeBeaconStatus,
} from "../../platform/nativeBridge";
import type { BeaconState } from "./beaconCodec";
import {
  readBeaconEnabled,
  readBeaconIntroSeen,
  readBeaconTrade,
  writeBeaconEnabled,
  writeBeaconIntroSeen,
  writeBeaconTrade,
  type BeaconTrade,
} from "./beaconSettings";

export interface NearbyContact {
  readonly pubkey: Pubkey;
  readonly contactId: ContactId;
  readonly state: BeaconState;
}

interface Sighting {
  readonly pubkey: Pubkey;
  readonly state: BeaconState;
  readonly lastSeenMs: number;
}

/** Who the app may show: contacts by pubkey, and pubkeys never shown (blocked, own). */
export interface BeaconPeers {
  readonly contactIdByPubkey: ReadonlyMap<Pubkey, ContactId>;
  readonly hidden: ReadonlySet<Pubkey>;
}

export interface BeaconSnapshot {
  readonly supported: boolean;
  readonly enabled: boolean;
  readonly trade: BeaconTrade;
  readonly introSeen: boolean;
  readonly permission: BeaconPermissionState;
  readonly status: NativeBeaconStatus;
  readonly keyCount: number;
  readonly nearbyContacts: ReadonlyArray<NearbyContact>;
  readonly nearbyIdentities: ReadonlyArray<Pubkey>;
  readonly pendingOpen: {
    readonly pubkey: Pubkey;
    readonly atMs: number;
  } | null;
}

const TRADE_RANK: Record<BeaconState, number> = { buy: 0, sell: 0, nearby: 1 };

/** Contact-set and identity-set sightings of contacts, merged per pubkey; trades first, then the most recently seen. */
export const nearbyContactsFrom = (
  sightings: ReadonlyArray<Sighting>,
  peers: BeaconPeers,
): ReadonlyArray<NearbyContact> => {
  const byPubkey = new Map<Pubkey, Sighting>();
  for (const sighting of sightings) {
    const known = byPubkey.get(sighting.pubkey);
    byPubkey.set(sighting.pubkey, {
      pubkey: sighting.pubkey,
      state: known && known.state !== "nearby" ? known.state : sighting.state,
      lastSeenMs: Math.max(known?.lastSeenMs ?? 0, sighting.lastSeenMs),
    });
  }
  return [...byPubkey.values()]
    .flatMap((sighting) => {
      const contactId = peers.contactIdByPubkey.get(sighting.pubkey);
      return contactId && !peers.hidden.has(sighting.pubkey)
        ? [{ ...sighting, contactId }]
        : [];
    })
    .sort(
      (a, b) =>
        TRADE_RANK[a.state] - TRADE_RANK[b.state] ||
        b.lastSeenMs - a.lastSeenMs,
    )
    .map(({ pubkey, contactId, state }) => ({ pubkey, contactId, state }));
};

export const nearbyIdentitiesFrom = (
  identities: ReadonlyArray<Pubkey>,
  peers: BeaconPeers,
): ReadonlyArray<Pubkey> =>
  identities.filter(
    (pubkey) =>
      !peers.contactIdByPubkey.has(pubkey) && !peers.hidden.has(pubkey),
  );

const PENDING_OPEN_TTL_MS = 60_000;
const PERMISSION_TIMEOUT_MS = 60_000;

export const NO_BEACON_PEERS: BeaconPeers = {
  contactIdByPubkey: new Map(),
  hidden: new Set(),
};

let peers = NO_BEACON_PEERS;
let contactSightings: ReadonlyArray<NativeBeaconSighting> = [];
let identitySightings: ReadonlyArray<Sighting> = [];
let keyTable: ReadonlyArray<NativeBeaconKey> | null = null;
/** What native last received from this store; reset when the service stops. */
let ownPubkey: Pubkey | null = null;
const NOTHING_PUSHED = {
  identity: null,
  keys: null,
  trade: null,
  started: false,
} as const;
let pushed: {
  identity: Pubkey | null;
  keys: string | null;
  trade: BeaconTrade | null;
  started: boolean;
} = { ...NOTHING_PUSHED };

// The notification's Stop action ran while no page was listening.
if (takeNativeBeaconStoppedByUser()) writeBeaconEnabled(false);

let snapshot: BeaconSnapshot = {
  supported: false,
  enabled: readBeaconEnabled(),
  trade: readBeaconTrade(),
  introSeen: readBeaconIntroSeen(),
  permission: getNativeBeaconPermissionState(),
  status: {
    running: false,
    bluetoothOn: true,
    advertising: false,
    error: null,
  },
  keyCount: 0,
  nearbyContacts: [],
  nearbyIdentities: [],
  pendingOpen: null,
};
const listeners = new Set<() => void>();

export const getBeaconSnapshot = (): BeaconSnapshot => snapshot;

export const subscribeBeacon = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const reportNearbyChanges = (
  before: ReadonlyArray<NearbyContact>,
  after: ReadonlyArray<NearbyContact>,
): void => {
  const ids = (list: ReadonlyArray<NearbyContact>) =>
    list.map((contact) => contact.contactId);
  const [was, is] = [ids(before), ids(after)];
  for (const contactId of is.filter((id) => !was.includes(id)))
    reportAppLog({
      tag: "beacon.nearbySeen",
      summary: "A contact's beacon came into range",
      links: { contact: contactId },
      payload: { contactId },
    });
  for (const contactId of was.filter((id) => !is.includes(id)))
    reportAppLog({
      tag: "beacon.nearbyExpired",
      summary: "A contact's beacon was not received for two minutes",
      links: { contact: contactId },
      payload: { contactId },
    });
};

/** Keeps the previous list when equal, so selectors do not re-render on unrelated updates. */
const unlessEqual = <A>(previous: A, next: A): A =>
  JSON.stringify(previous) === JSON.stringify(next) ? previous : next;

const update = (patch: Partial<BeaconSnapshot>): void => {
  const nearbyContacts = nearbyContactsFrom(
    [...contactSightings, ...identitySightings],
    peers,
  );
  reportNearbyChanges(snapshot.nearbyContacts, nearbyContacts);
  snapshot = {
    ...snapshot,
    keyCount: keyTable?.length ?? 0,
    nearbyContacts: unlessEqual(snapshot.nearbyContacts, nearbyContacts),
    nearbyIdentities: unlessEqual(
      snapshot.nearbyIdentities,
      nearbyIdentitiesFrom(
        identitySightings.map((sighting) => sighting.pubkey),
        peers,
      ),
    ),
    ...patch,
  };
  reconcileNative();
  for (const listener of listeners) listener();
};

/** Brings the native service in line with the switch, the permission and the latest key table. */
const reconcileNative = (): void => {
  const { supported, enabled, permission, trade } = snapshot;
  if (
    !supported ||
    !enabled ||
    permission !== "granted" ||
    !keyTable ||
    !ownPubkey
  ) {
    if (!pushed.started) return;
    stopNativeBeacon();
    pushed = { ...NOTHING_PUSHED };
    reportAppLog({
      tag: "beacon.stopped",
      summary: "Beacon stopped",
      payload: { enabled, permission, supported },
    });
    return;
  }
  if (ownPubkey !== pushed.identity) {
    setNativeBeaconIdentity(ownPubkey);
    pushed.identity = ownPubkey;
  }
  const keys = JSON.stringify(keyTable);
  if (keys !== pushed.keys) {
    setNativeBeaconKeys(keyTable);
    pushed.keys = keys;
    reportAppLog({
      tag: "beacon.keysPushed",
      summary: `Beacon key table pushed for ${keyTable.length} contacts`,
      payload: { count: keyTable.length },
    });
  }
  if (trade !== pushed.trade) {
    setNativeBeaconTrade(trade);
    pushed.trade = trade;
  }
  if (!pushed.started) {
    startNativeBeacon();
    pushed.started = true;
    reportAppLog({
      tag: "beacon.started",
      summary: "Beacon started",
      payload: { count: keyTable.length, trade },
    });
  }
};

export const setBeaconEnabled = (enabled: boolean): void => {
  writeBeaconEnabled(enabled);
  update({ enabled });
};

export const setBeaconTrade = (trade: BeaconTrade): void => {
  writeBeaconTrade(trade);
  reportAppLog({
    tag: "beacon.tradeSet",
    summary: `Beacon trade set to ${trade}`,
    payload: { trade },
  });
  update({ trade });
};

export const markBeaconIntroSeen = (): void => {
  writeBeaconIntroSeen();
  update({ introSeen: true });
};

/** Set by the controller while the account is open. */
export const setBeaconPeers = (context: {
  readonly supported: boolean;
  readonly peers: BeaconPeers;
  readonly ownPubkey: Pubkey | null;
}): void => {
  peers = context.peers;
  ownPubkey = context.ownPubkey;
  update({ supported: context.supported });
};

/** `null` until contacts were read, which keeps the service from starting with an empty table. */
export const setBeaconKeyTable = (
  next: ReadonlyArray<NativeBeaconKey> | null,
): void => {
  if (JSON.stringify(next) === JSON.stringify(keyTable)) return;
  keyTable = next;
  update({});
};

const setPermission = (permission: BeaconPermissionState): void => {
  if (permission === snapshot.permission) return;
  reportAppLog({
    tag: "beacon.permissionChanged",
    summary: `Beacon permission is ${permission}`,
    payload: { from: snapshot.permission, to: permission },
  });
  update({ permission });
};

export const refreshBeaconPermission = (): void =>
  setPermission(getNativeBeaconPermissionState());

/** Resolves with the permission native reports after asking the user. */
export const requestBeaconPermissions = (): Promise<BeaconPermissionState> =>
  new Promise((resolve) => {
    const finish = (permission: BeaconPermissionState) => {
      window.clearTimeout(timeout);
      stopListening();
      resolve(permission);
    };
    const timeout = window.setTimeout(
      () => finish(snapshot.permission),
      PERMISSION_TIMEOUT_MS,
    );
    const stopListening = onNativeBeaconPermission(finish);
    if (!requestNativeBeaconPermissions()) finish(snapshot.permission);
  });

export const clearBeaconIdentities = (): void => {
  identitySightings = [];
  update({});
};

/** The pubkey of a tapped trade notification, if it is recent enough to still open. */
export const takeBeaconPendingOpen = (): Pubkey | null => {
  const pending = snapshot.pendingOpen;
  if (!pending) return null;
  update({ pendingOpen: null });
  return Date.now() - pending.atMs <= PENDING_OPEN_TTL_MS
    ? pending.pubkey
    : null;
};

const onStatus = (status: NativeBeaconStatus): void => {
  if (JSON.stringify(status) !== JSON.stringify(snapshot.status))
    reportAppLog({
      tag: "beacon.statusChanged",
      summary: status.running
        ? `Beacon running, Bluetooth ${status.bluetoothOn ? "on" : "off"}`
        : "Beacon service not running",
      payload: status,
    });
  // The notification's Stop action: off until the user turns the switch on again.
  if (
    !status.running &&
    status.error === null &&
    (takeNativeBeaconStoppedByUser() || pushed.started)
  ) {
    pushed = { ...NOTHING_PUSHED };
    writeBeaconEnabled(false);
    update({ status, enabled: false });
    return;
  }
  update({ status });
  // A failed start is retried on the next store change or return to the app rather than in a loop.
  if (!status.running && status.error !== null) pushed = { ...NOTHING_PUSHED };
};

if (typeof window !== "undefined") {
  onNativeBeaconPermission(setPermission);
  onNativeBeaconStatus(onStatus);
  onNativeBeaconNearby((contacts) => {
    contactSightings = contacts;
    update({});
  });
  onNativeBeaconIdentities((pubkeys) => {
    const atMs = Date.now();
    identitySightings = pubkeys.map((pubkey) => ({
      pubkey,
      state: "nearby",
      lastSeenMs: atMs,
    }));
    update({});
  });
  onNativeBeaconOpenConversation((pubkey) =>
    update({ pendingOpen: { pubkey, atMs: Date.now() } }),
  );
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    refreshBeaconPermission();
    reconcileNative();
  });
}
