import { identityFromNsec } from "@linky/linkstr";
import { base64 } from "@scure/base";
import { Schema } from "effect";
import type { PluginListenerHandle } from "@capacitor/core";
import { getInspectorEmissionEnabled } from "../devtools/inspector/inspectorEnabled";
import { reportInspectorRows } from "../devtools/inspector/reportInspectorRows";
import { readStoredSecret, writeStoredSecret } from "../platform/secretStorage";
import { safeLocalStorageGet, safeLocalStorageSet } from "../utils/storage";
import {
  createIdentityProof,
  IdentityAssembler,
  newIdentityChallenge,
  verifyIdentityProof,
  frameIdentityPacket,
  type NearbyIdentity,
  type IdentityPacket,
} from "./identity";
import {
  createMeshSession,
  normalizeMeshNickname,
  type MeshMessage,
} from "./mesh";
import {
  BluetoothError,
  BluetoothPacket,
  BluetoothPeer,
  decodeBluetoothState,
  inactiveBluetoothState,
  type BluetoothState,
  type BluetoothTransport,
} from "./transport";

import { BLUETOOTH_ENABLED_KEY, BLUETOOTH_IDENTITY_KEY } from "./storageKeys";
const StoredKeys = Schema.Struct({
  owner: Schema.String,
  signing: Schema.String,
  noise: Schema.String,
});
const MAX_LINKS = 32;

export interface BluetoothSnapshot {
  enabled: boolean;
  busy: boolean;
  state: BluetoothState;
  error: string | null;
  nearby: readonly NearbyIdentity[];
  nearbyCount: number;
  messages: readonly MeshMessage[];
}

export const emptyBluetoothSnapshot: BluetoothSnapshot = {
  enabled: false,
  busy: false,
  state: inactiveBluetoothState,
  error: null,
  nearby: [],
  nearbyCount: 0,
  messages: [],
};

interface DirectPeer {
  transport: BluetoothPeer;
  assembler: IdentityAssembler;
  challenge: ReturnType<typeof newIdentityChallenge> | null;
  challengedAt: number;
  verifiedAt: number;
  identity: NearbyIdentity | null;
  sendQueue: Promise<void>;
  identityQueue: Promise<void>;
  receiveQueue: Promise<void>;
  pendingSends: number;
  pendingReceives: number;
}

const logBluetooth = (
  tag: string,
  summary: string,
  payload: unknown,
  links: Record<string, string> = {},
) => {
  if (!getInspectorEmissionEnabled()) return;
  reportInspectorRows([
    {
      at: Date.now(),
      channel: tag.startsWith("bluetooth.wire")
        ? "bluetooth.wire"
        : "bluetooth.operation",
      tag,
      summary,
      links,
      payload,
    },
  ]);
};

// Native plugin instances outlive React trees; serialize ownership across logins.
let nativeLifecycle: Promise<void> = Promise.resolve();

export class BluetoothController {
  private snapshot: BluetoothSnapshot;
  private listeners = new Set<() => void>();
  private handles: PluginListenerHandle[] = [];
  private peers = new Map<string, DirectPeer>();
  private mesh: ReturnType<typeof createMeshSession> | null = null;
  private meshPeers = new Map<string, readonly string[]>();
  private disposed = false;
  private starting = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nickname: string;
  private identity;
  private transport: BluetoothTransport;
  private available: boolean;

  constructor(
    transport: BluetoothTransport,
    available: boolean,
    nsec: string,
    nickname: string,
  ) {
    this.transport = transport;
    this.available = available;
    this.identity = identityFromNsec(nsec);
    this.nickname = normalizeMeshNickname(nickname);
    this.snapshot = {
      ...emptyBluetoothSnapshot,
      enabled: available && safeLocalStorageGet(BLUETOOTH_ENABLED_KEY) === "1",
    };
  }

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private update(patch: Partial<BluetoothSnapshot>) {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  private enqueue(operation: () => Promise<void>) {
    const next = nativeLifecycle.then(operation);
    nativeLifecycle = next.catch(() => undefined);
    return next;
  }

  private fail = (error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Bluetooth operation failed";
    this.update({ error: message });
    logBluetooth("bluetooth.failed", message, { message });
  };

  private acceptState(state: BluetoothState) {
    const previous = this.snapshot.state;
    this.update({ state });
    if (!state.active && !this.starting) this.clearSession();
    if (JSON.stringify(previous) !== JSON.stringify(state))
      logBluetooth(
        "bluetooth.stateChanged",
        "Bluetooth availability changed",
        state,
      );
  }

  watch() {
    if (!this.available) return;
    void this.enqueue(async () => {
      if (this.disposed) return;
      this.handles.push(
        await this.transport.addListener("state", (raw) => {
          try {
            const state = decodeBluetoothState(raw);
            const becameAvailable =
              (!this.snapshot.state.powered && state.powered) ||
              (this.snapshot.state.permission !== "granted" &&
                state.permission === "granted");
            this.acceptState(state);
            if (becameAvailable) this.refresh();
          } catch (error) {
            this.fail(error);
          }
        }),
      );
      this.handles.push(
        await this.transport.addListener("peer", (raw) => {
          try {
            this.peerChanged(Schema.decodeUnknownSync(BluetoothPeer)(raw));
          } catch (error) {
            this.fail(error);
          }
        }),
      );
      this.handles.push(
        await this.transport.addListener("packet", (raw) => {
          try {
            const packet = Schema.decodeUnknownSync(BluetoothPacket)(raw);
            const peer = this.peers.get(packet.peerId);
            if (!peer || peer.pendingReceives >= 128) return;
            const bytes = base64.decode(packet.data);
            if (bytes.length > 65536) return;
            peer.pendingReceives++;
            peer.receiveQueue = peer.receiveQueue
              .then(async () => {
                if (this.peers.get(packet.peerId) !== peer) return;
                logBluetooth(
                  "bluetooth.wireReceived",
                  "Bluetooth frame received",
                  { lane: packet.lane, bytes: bytes.length },
                  { bluetoothLink: packet.peerId },
                );
                if (packet.lane === "mesh")
                  await this.mesh?.receive(packet.peerId, bytes);
                else {
                  const identityPacket = peer.assembler.receive(bytes);
                  if (identityPacket)
                    await this.receiveIdentity(
                      packet.peerId,
                      peer,
                      identityPacket,
                    );
                }
              })
              .catch(this.fail)
              .finally(() => {
                peer.pendingReceives--;
              });
          } catch (error) {
            this.fail(error);
          }
        }),
      );
      this.handles.push(
        await this.transport.addListener("error", (raw) => {
          try {
            this.fail(
              new Error(Schema.decodeUnknownSync(BluetoothError)(raw).message),
            );
          } catch (error) {
            this.fail(error);
          }
        }),
      );
      const state = decodeBluetoothState(await this.transport.getState());
      this.acceptState(state);
      await this.startIfReady();
      if (!this.disposed)
        this.timer = setInterval(() => this.refreshPresence(), 5000);
    }).catch(this.fail);
  }

  refresh = () => {
    if (!this.available || this.disposed) return;
    void this.enqueue(async () => {
      if (this.disposed) return;
      this.acceptState(decodeBluetoothState(await this.transport.getState()));
      await this.startIfReady();
    }).catch(this.fail);
  };

  setEnabled = async (enabled: boolean) => {
    if (!this.available || this.disposed || this.snapshot.busy) return;
    this.update({ busy: true, error: null });
    try {
      await this.enqueue(async () => {
        if (this.disposed) return;
        if (enabled) {
          const state = decodeBluetoothState(
            await this.transport.requestPermissions(),
          );
          this.acceptState(state);
          enabled = state.supported && state.permission === "granted";
        }
        safeLocalStorageSet(BLUETOOTH_ENABLED_KEY, enabled ? "1" : "0");
        this.update({ enabled });
        logBluetooth(
          "bluetooth.settingChanged",
          enabled ? "Bluetooth chat enabled" : "Bluetooth chat disabled",
          { enabled },
        );
        if (enabled) await this.startIfReady();
        else {
          this.clearSession();
          this.update({ messages: [] });
          this.acceptState(decodeBluetoothState(await this.transport.stop()));
        }
      });
    } catch (error) {
      this.fail(error);
    } finally {
      this.update({ busy: false });
    }
  };

  private async loadKeys() {
    const owner = this.identity?.pubkey;
    if (!owner) throw new Error("Bluetooth needs a Linky identity");
    const raw = await readStoredSecret(BLUETOOTH_IDENTITY_KEY);
    if (raw) {
      try {
        const stored = Schema.decodeUnknownSync(Schema.parseJson(StoredKeys))(
          raw,
        );
        const signingKey = base64.decode(stored.signing);
        const noiseKey = base64.decode(stored.noise);
        if (
          stored.owner === owner &&
          signingKey.length === 32 &&
          noiseKey.length === 32
        )
          return { signingKey, noiseKey };
      } catch {
        /* A damaged device identity is replaced before advertising. */
      }
    }
    const signingKey = crypto.getRandomValues(new Uint8Array(32));
    const noiseKey = crypto.getRandomValues(new Uint8Array(32));
    await writeStoredSecret(
      BLUETOOTH_IDENTITY_KEY,
      JSON.stringify({
        owner,
        signing: base64.encode(signingKey),
        noise: base64.encode(noiseKey),
      }),
    );
    return { signingKey, noiseKey };
  }

  private async startIfReady() {
    const { enabled, state } = this.snapshot;
    if (
      this.disposed ||
      !enabled ||
      !state.supported ||
      state.permission !== "granted" ||
      !state.powered ||
      document.visibilityState === "hidden" ||
      this.mesh
    )
      return;
    const keys = await this.loadKeys();
    if (this.disposed || !this.snapshot.enabled) return;
    this.mesh = createMeshSession({
      ...keys,
      nickname: this.nickname,
      send: (id, bytes) => this.sendFrame(id, "mesh", bytes),
      onMessage: (message) => {
        if (
          this.snapshot.messages.some((existing) => existing.id === message.id)
        )
          return;
        this.update({
          messages: [...this.snapshot.messages, message].slice(-300),
        });
        logBluetooth(
          "bluetooth.publicMessage",
          message.own
            ? "Public Bluetooth message sent"
            : "Public Bluetooth message received",
          { text: message.text, nickname: message.nickname },
          { bluetoothPeer: message.peerId, bluetoothMessage: message.id },
        );
      },
      onPeer: (peer) => {
        if (peer.directLinkIds.length)
          this.meshPeers.set(peer.id, peer.directLinkIds);
        else this.meshPeers.delete(peer.id);
        this.publishPresence();
      },
      onError: (message) => this.fail(new Error(message)),
    });
    try {
      this.starting = true;
      const started = decodeBluetoothState(await this.transport.start());
      this.starting = false;
      this.acceptState(started);
      if (started.active) this.update({ error: null });
    } catch (error) {
      this.clearSession();
      throw error;
    } finally {
      this.starting = false;
    }
  }

  private clearSession() {
    this.mesh?.dispose();
    this.mesh = null;
    this.peers.clear();
    this.meshPeers.clear();
    this.update({ nearby: [], nearbyCount: 0 });
  }

  private peerChanged(event: BluetoothPeer) {
    if (!this.mesh || this.disposed) return;
    const existing = this.peers.get(event.id);
    if (!event.connected) {
      this.peers.delete(event.id);
      this.mesh.disconnect(event.id);
    } else if (existing) {
      const gainedIdentity = !existing.transport.identity && event.identity;
      existing.transport = event;
      this.mesh.connect(event.id, event.maxPacketSize);
      if (gainedIdentity)
        void this.challengePeer(event.id, existing).catch(this.fail);
    } else if (this.peers.size < MAX_LINKS) {
      const peer: DirectPeer = {
        transport: event,
        assembler: new IdentityAssembler(),
        challenge: null,
        challengedAt: 0,
        verifiedAt: 0,
        identity: null,
        sendQueue: Promise.resolve(),
        identityQueue: Promise.resolve(),
        receiveQueue: Promise.resolve(),
        pendingSends: 0,
        pendingReceives: 0,
      };
      this.peers.set(event.id, peer);
      this.mesh.connect(event.id, event.maxPacketSize);
      if (event.identity)
        void this.challengePeer(event.id, peer).catch(this.fail);
    }
    logBluetooth(
      "bluetooth.peerChanged",
      event.connected
        ? "Bluetooth peer connected"
        : "Bluetooth peer disconnected",
      {
        connected: event.connected,
        identity: event.identity,
        maxPacketSize: event.maxPacketSize,
      },
      { bluetoothLink: event.id },
    );
    this.publishPresence();
  }

  private async sendFrame(
    id: string,
    lane: "mesh" | "identity",
    bytes: Uint8Array,
  ) {
    const peer = this.peers.get(id);
    if (!peer || this.disposed) throw new Error("Bluetooth peer disconnected");
    if (peer.pendingSends >= 256) throw new Error("Bluetooth send queue full");
    peer.pendingSends++;
    const send = peer.sendQueue.then(async () => {
      if (this.peers.get(id) !== peer || this.disposed)
        throw new Error("Bluetooth peer disconnected");
      await this.transport.send({
        peerId: id,
        lane,
        data: base64.encode(bytes),
      });
      logBluetooth(
        "bluetooth.wireSent",
        "Bluetooth frame sent",
        { lane, bytes: bytes.length },
        { bluetoothLink: id },
      );
    });
    peer.sendQueue = send.catch(() => undefined);
    try {
      await send;
    } finally {
      peer.pendingSends--;
    }
  }

  private async sendIdentity(
    id: string,
    peer: DirectPeer,
    packet: IdentityPacket,
  ) {
    const send = peer.identityQueue.then(async () => {
      for (const frame of frameIdentityPacket(
        packet,
        peer.transport.maxPacketSize,
      ))
        await this.sendFrame(id, "identity", frame);
    });
    peer.identityQueue = send.catch(() => undefined);
    await send;
  }

  private async challengePeer(id: string, peer: DirectPeer) {
    if (!this.mesh || !peer.transport.identity) return;
    peer.challenge = newIdentityChallenge(this.mesh.ownPeerId);
    peer.challengedAt = Date.now();
    await this.sendIdentity(id, peer, peer.challenge);
    logBluetooth(
      "bluetooth.identityRequested",
      "Requested nearby Linky identity",
      {},
      { bluetoothLink: id },
    );
  }

  private async receiveIdentity(
    id: string,
    peer: DirectPeer,
    packet: IdentityPacket,
  ) {
    if (!this.mesh || !this.identity || !peer.transport.identity) return;
    if (packet.type === "challenge") {
      await this.sendIdentity(
        id,
        peer,
        createIdentityProof(packet, this.identity, this.mesh.ownPeerId, ""),
      );
      return;
    }
    const challengeIsFresh =
      peer.challenge !== null && Date.now() - peer.challengedAt <= 15_000;
    const identity =
      challengeIsFresh && peer.challenge
        ? verifyIdentityProof(packet, peer.challenge)
        : null;
    if (!identity || identity.pubkey === this.identity.pubkey) {
      logBluetooth(
        "bluetooth.identityIgnored",
        "Nearby Linky identity proof ignored",
        {
          reason: !challengeIsFresh
            ? "no-fresh-challenge"
            : !identity
              ? "invalid-proof"
              : "own-account",
        },
        { bluetoothLink: id, bluetoothPeer: packet.meshId },
      );
      return;
    }
    peer.challenge = null;
    peer.identity = identity;
    peer.verifiedAt = Date.now();
    logBluetooth(
      "bluetooth.identityVerified",
      "Nearby Linky identity verified",
      {},
      {
        bluetoothLink: id,
        bluetoothPeer: identity.meshId,
        pubkey: identity.pubkey,
      },
    );
    this.publishPresence();
  }

  private refreshPresence() {
    if (this.disposed || !this.mesh) return;
    for (const [id, peer] of this.peers) {
      if (peer.transport.identity && Date.now() - peer.challengedAt > 20_000)
        void this.challengePeer(id, peer).catch(this.fail);
    }
    this.publishPresence();
  }

  private publishPresence() {
    const nearby = new Map<string, NearbyIdentity>();
    const meshIds = new Set<string>();
    for (const [id, links] of this.meshPeers)
      if (links.some((link) => this.peers.has(link))) meshIds.add(id);
    for (const peer of this.peers.values()) {
      if (peer.identity && Date.now() - peer.verifiedAt < 60_000) {
        nearby.set(peer.identity.npub, peer.identity);
        meshIds.add(peer.identity.meshId);
      }
    }
    this.update({ nearby: [...nearby.values()], nearbyCount: meshIds.size });
  }

  setNickname(name: string) {
    this.nickname = normalizeMeshNickname(name);
    this.mesh?.setNickname(this.nickname);
  }
  sendMessage = async (text: string) => {
    if (!this.mesh || !this.snapshot.state.active)
      throw new Error("Bluetooth chat is inactive");
    try {
      await this.mesh.sendMessage(text);
    } catch (error) {
      this.fail(error);
      throw error;
    }
  };

  dispose() {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.clearSession();
    void this.enqueue(async () => {
      await Promise.all(this.handles.map((handle) => handle.remove()));
      this.handles = [];
      if (this.available) await this.transport.stop();
    }).catch(() => undefined);
    this.listeners.clear();
  }
}
