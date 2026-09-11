import { x25519, ed25519 } from "@noble/curves/ed25519";
import { bytesToHex } from "@noble/hashes/utils";
import { sleep } from "../utils/time";
import {
  decodeMeshAnnouncement,
  decodeMeshPacket,
  encodeMeshAnnouncement,
  fragmentMeshPacket,
  isMeshBroadcast,
  joinMeshBytes,
  MAX_MESSAGE_BYTES,
  MAX_PACKET_BYTES,
  MESH_TTL,
  meshMessageId,
  meshPeerId,
  meshText,
  meshUtf8,
  normalizeMeshNickname,
  signMeshPacket,
  verifyMeshPacket,
  type MeshPacket,
} from "./meshCodec";

export {
  MAX_MESSAGE_BYTES,
  MAX_NICKNAME_BYTES,
  normalizeMeshNickname,
} from "./meshCodec";

export interface MeshMessage {
  id: string;
  peerId: string;
  nickname: string;
  text: string;
  timestamp: number;
  own: boolean;
}

export interface MeshPeer {
  id: string;
  nickname: string;
  directLinkIds: string[];
  lastSeenAt: number;
}

export interface MeshSessionOptions {
  signingKey: Uint8Array;
  noiseKey: Uint8Array;
  nickname: string;
  onMessage: (message: MeshMessage) => void;
  onPeer: (peer: MeshPeer) => void;
  send: (peerId: string, bytes: Uint8Array) => void | Promise<void>;
  onError?: (message: string) => void;
}

export interface MeshSession {
  readonly ownPeerId: string;
  readonly noisePublicKey: Uint8Array;
  readonly signingPublicKey: Uint8Array;
  connect: (peerId: string, maxPacketSize: number) => void;
  disconnect: (peerId: string) => void;
  receive: (peerId: string, bytes: Uint8Array) => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  setNickname: (nickname: string) => void;
  dispose: () => void;
}

interface Link {
  maxPacketSize: number;
  peerId?: string;
  tail: Promise<void>;
  queued: number;
}

interface PeerState {
  peer: MeshPeer;
  signingPublicKey: Uint8Array;
}

interface SigningPin {
  publicKey: Uint8Array;
  expiresAt: number;
}

interface FragmentAssembly {
  sender: string;
  type: number;
  timestamp: number;
  total: number;
  ttl: number;
  parts: Map<number, Uint8Array>;
  bytes: number;
  createdAt: number;
}

const ANNOUNCE = 1;
const MESSAGE = 2;
const LEAVE = 3;
const FRAGMENT = 32;
const PEER_TIMEOUT_MS = 45_000;
const MAX_PEERS = 256;
const MAX_SIGNING_PINS = 1024;
const SIGNING_PIN_RETENTION_MS = 15 * 60 * 1000;
const MAX_LINKS = 16;
const MAX_SEEN_PACKETS = 2048;
const MAX_QUEUED_PACKETS = 64;
const equalBytes = (left: Uint8Array, right: Uint8Array): boolean =>
  left.length === right.length &&
  left.every((byte, index) => byte === right[index]);

export function createMeshSession(options: MeshSessionOptions): MeshSession {
  if (options.signingKey.length !== 32 || options.noiseKey.length !== 32) {
    throw new Error("Bluetooth mesh identity keys must contain 32 bytes");
  }
  const signingKey = new Uint8Array(options.signingKey);
  const noisePublicKey = x25519.getPublicKey(options.noiseKey);
  const signingPublicKey = ed25519.getPublicKey(signingKey);
  const ownPeerId = meshPeerId(noisePublicKey);
  const sender = new Uint8Array(8);
  for (let index = 0; index < 8; index++) {
    sender[index] = Number.parseInt(
      ownPeerId.slice(index * 2, index * 2 + 2),
      16,
    );
  }
  let nickname = normalizeMeshNickname(
    options.nickname,
    `linky_${ownPeerId.slice(0, 4)}`,
  );
  let disposed = false;
  let receiveTail = Promise.resolve();
  let queuedReceives = 0;
  let lastTimestamp = 0;
  const links = new Map<string, Link>();
  const peers = new Map<string, PeerState>();
  const signingPins = new Map<string, SigningPin>();
  const seen = new Map<string, number>();
  const assemblies = new Map<string, FragmentAssembly>();
  const unknownMessages: { linkId: string; packet: MeshPacket; at: number }[] =
    [];
  const relays = new Set<ReturnType<typeof setTimeout>>();

  const report = (error: unknown): void => {
    if (!disposed)
      options.onError?.(
        error instanceof Error
          ? error.message
          : "Bluetooth mesh operation failed",
      );
  };
  const publishPeer = (state: PeerState): void => {
    if (!disposed)
      options.onPeer({
        ...state.peer,
        directLinkIds: [...state.peer.directLinkIds],
      });
  };
  function removePeer(state: PeerState): void {
    peers.delete(state.peer.id);
    state.peer.directLinkIds = [];
    state.peer.lastSeenAt = 0;
    for (const link of links.values()) {
      if (link.peerId === state.peer.id) delete link.peerId;
    }
    publishPeer(state);
  }
  function expirePeers(now: number): void {
    for (const state of peers.values()) {
      if (now - state.peer.lastSeenAt >= PEER_TIMEOUT_MS) removePeer(state);
    }
  }
  function retainSigningPin(
    id: string,
    publicKey: Uint8Array,
    now: number,
  ): void {
    signingPins.delete(id);
    signingPins.set(id, {
      publicKey,
      expiresAt: now + SIGNING_PIN_RETENTION_MS,
    });
    if (signingPins.size > MAX_SIGNING_PINS) {
      const oldestInactive = [...signingPins.keys()].find(
        (peerId) => !peers.has(peerId),
      );
      if (oldestInactive) signingPins.delete(oldestInactive);
    }
  }
  const timestamp = (): number => {
    lastTimestamp = Math.max(Date.now(), lastTimestamp + 1);
    return lastTimestamp;
  };
  const createPacket = (type: number, payload: Uint8Array): MeshPacket =>
    signMeshPacket(
      {
        version: 1,
        type,
        ttl: MESH_TTL,
        timestamp: timestamp(),
        sender,
        payload,
      },
      signingKey,
    );
  const packetId = (packet: MeshPacket): string =>
    `${bytesToHex(packet.sender)}:${packet.timestamp}:${packet.type}`;
  const markSeen = (packet: MeshPacket): void => {
    seen.set(packetId(packet), Date.now());
    if (seen.size > MAX_SEEN_PACKETS) {
      const oldest = seen.keys().next().value;
      if (oldest) seen.delete(oldest);
    }
  };

  async function sendTo(linkId: string, packet: MeshPacket): Promise<void> {
    const link = links.get(linkId);
    if (!link || disposed)
      return Promise.reject(new Error("Bluetooth peer disconnected"));
    if (link.queued >= MAX_QUEUED_PACKETS)
      return Promise.reject(new Error("Bluetooth send queue is full"));
    const frames = fragmentMeshPacket(packet, link.maxPacketSize);
    link.queued++;
    const operation = link.tail.then(async () => {
      for (let index = 0; index < frames.length; index++) {
        if (disposed || links.get(linkId) !== link)
          throw new Error("Bluetooth peer disconnected");
        await options.send(linkId, frames[index]);
        if (index + 1 < frames.length) await sleep(10);
      }
    });
    link.tail = operation
      .catch(() => {})
      .finally(() => {
        link.queued--;
      });
    return operation;
  }

  async function broadcast(
    packet: MeshPacket,
    excluding?: string,
  ): Promise<number> {
    const destinations = [...links.keys()].filter((id) => id !== excluding);
    const results = await Promise.allSettled(
      destinations.map((id) => sendTo(id, packet)),
    );
    for (const result of results) {
      if (result.status === "rejected") report(result.reason);
    }
    return results.filter((result) => result.status === "fulfilled").length;
  }

  function announce(linkId?: string): void {
    if (disposed || !links.size) return;
    const packet = createPacket(
      ANNOUNCE,
      encodeMeshAnnouncement({ nickname, noisePublicKey, signingPublicKey }),
    );
    markSeen(packet);
    if (linkId) void sendTo(linkId, packet).catch(report);
    else void broadcast(packet).catch(report);
  }

  function scheduleRelay(packet: MeshPacket, linkId: string): void {
    if (packet.ttl <= 1 || links.size <= 1 || relays.size >= MAX_QUEUED_PACKETS)
      return;
    const timer = setTimeout(
      () => {
        relays.delete(timer);
        if (!disposed)
          void broadcast({ ...packet, ttl: packet.ttl - 1 }, linkId).catch(
            report,
          );
      },
      30 + Math.floor(Math.random() * 100),
    );
    relays.add(timer);
  }

  function acceptAnnouncement(packet: MeshPacket, linkId: string): void {
    const announcement = decodeMeshAnnouncement(packet.payload);
    const id = bytesToHex(packet.sender);
    if (meshPeerId(announcement.noisePublicKey) !== id)
      throw new Error("Bluetooth announcement identity mismatch");
    const previous = peers.get(id);
    const now = Date.now();
    const retainedPin = signingPins.get(id);
    const pinnedKey =
      previous?.signingPublicKey ??
      (retainedPin && retainedPin.expiresAt > now
        ? retainedPin.publicKey
        : undefined);
    if (pinnedKey && !equalBytes(pinnedKey, announcement.signingPublicKey)) {
      throw new Error("Bluetooth peer changed its signing key");
    }
    if (!verifyMeshPacket(packet, announcement.signingPublicKey))
      throw new Error("Invalid Bluetooth announcement signature");
    if (!previous && peers.size >= MAX_PEERS) expirePeers(now);
    if (!previous && peers.size >= MAX_PEERS)
      throw new Error("Bluetooth mesh peer limit reached");
    const link = links.get(linkId);
    const state: PeerState = previous ?? {
      peer: {
        id,
        nickname: announcement.nickname,
        directLinkIds: [],
        lastSeenAt: Date.now(),
      },
      signingPublicKey: announcement.signingPublicKey,
    };
    state.peer.nickname = announcement.nickname;
    state.peer.lastSeenAt = Date.now();
    // This records a transport observation. Linky friend identity is verified separately.
    if (
      link &&
      packet.ttl === MESH_TTL &&
      (!link.peerId || link.peerId === id)
    ) {
      link.peerId = id;
      if (!state.peer.directLinkIds.includes(linkId))
        state.peer.directLinkIds.push(linkId);
    }
    peers.set(id, state);
    retainSigningPin(id, announcement.signingPublicKey, now);
    publishPeer(state);
    if (!previous) announce(linkId);
  }

  function acceptKnownPacket(packet: MeshPacket): boolean {
    const state = peers.get(bytesToHex(packet.sender));
    if (!state) return false;
    if (!verifyMeshPacket(packet, state.signingPublicKey))
      throw new Error("Invalid Bluetooth message signature");
    if (packet.type === LEAVE) {
      removePeer(state);
      return true;
    }
    const text = meshText(packet.payload);
    if (!text.trim()) return true;
    options.onMessage({
      id: meshMessageId(packet),
      peerId: state.peer.id,
      nickname: state.peer.nickname,
      text,
      timestamp: packet.timestamp,
      own: false,
    });
    return true;
  }

  async function processPacket(
    packet: MeshPacket,
    linkId: string,
  ): Promise<void> {
    if (disposed || !links.has(linkId) || !isMeshBroadcast(packet)) return;
    if (![ANNOUNCE, MESSAGE, LEAVE, FRAGMENT].includes(packet.type)) return;
    if (equalBytes(packet.sender, sender)) return;
    const age = Date.now() - packet.timestamp;
    const maxAge =
      packet.type === MESSAGE ? 6 * 60 * 60 * 1000 : 10 * 60 * 1000;
    if (age < -60_000 || age > maxAge)
      throw new Error("Stale Bluetooth mesh packet");
    if (packet.type === FRAGMENT) {
      const reassembled = await acceptFragment(packet);
      if (reassembled) await processPacket(reassembled, linkId);
      return;
    }
    if (seen.has(packetId(packet))) return;
    if (packet.type === ANNOUNCE) {
      acceptAnnouncement(packet, linkId);
      markSeen(packet);
      const id = bytesToHex(packet.sender);
      for (let index = 0; index < unknownMessages.length; ) {
        const pending = unknownMessages[index];
        if (bytesToHex(pending.packet.sender) !== id) {
          index++;
          continue;
        }
        unknownMessages.splice(index, 1);
        if (Date.now() - pending.at < 5000)
          await processPacket(pending.packet, pending.linkId).catch(report);
      }
    } else {
      if (!acceptKnownPacket(packet)) {
        if (unknownMessages.length < 32 && packet.payload.length <= 4096) {
          unknownMessages.push({ linkId, packet, at: Date.now() });
        }
        return;
      }
      markSeen(packet);
    }
    scheduleRelay(packet, linkId);
  }

  async function acceptFragment(
    packet: MeshPacket,
  ): Promise<MeshPacket | undefined> {
    if (packet.payload.length < 14)
      throw new Error("Truncated Bluetooth mesh fragment");
    const view = new DataView(
      packet.payload.buffer,
      packet.payload.byteOffset,
      packet.payload.byteLength,
    );
    const index = view.getUint16(8);
    const total = view.getUint16(10);
    const type = packet.payload[12];
    if (
      total < 1 ||
      total > 256 ||
      index >= total ||
      ![ANNOUNCE, MESSAGE, LEAVE].includes(type)
    ) {
      throw new Error("Invalid Bluetooth mesh fragment header");
    }
    const senderId = bytesToHex(packet.sender);
    const key = `${senderId}:${bytesToHex(packet.payload.slice(0, 8))}`;
    let assembly = assemblies.get(key);
    if (!assembly) {
      if (assemblies.size >= 16)
        throw new Error("Bluetooth fragment buffer is full");
      assembly = {
        sender: senderId,
        type,
        timestamp: packet.timestamp,
        total,
        ttl: packet.ttl,
        parts: new Map(),
        bytes: 0,
        createdAt: Date.now(),
      };
      assemblies.set(key, assembly);
    }
    const chunk = packet.payload.slice(13);
    const existing = assembly.parts.get(index);
    if (
      assembly.total !== total ||
      assembly.type !== type ||
      assembly.timestamp !== packet.timestamp ||
      (existing && !equalBytes(existing, chunk))
    ) {
      assemblies.delete(key);
      throw new Error("Conflicting Bluetooth mesh fragments");
    }
    if (!existing) {
      assembly.bytes += chunk.length;
      if (assembly.bytes > MAX_PACKET_BYTES) {
        assemblies.delete(key);
        throw new Error("Bluetooth fragment assembly is too large");
      }
      assembly.parts.set(index, chunk);
    }
    assembly.ttl = Math.min(assembly.ttl, packet.ttl);
    if (assembly.parts.size !== total) return;
    assemblies.delete(key);
    const parts: Uint8Array[] = [];
    for (let part = 0; part < total; part++) {
      const bytes = assembly.parts.get(part);
      if (!bytes) throw new Error("Incomplete Bluetooth fragment assembly");
      parts.push(bytes);
    }
    const inner = await decodeMeshPacket(joinMeshBytes(parts));
    if (
      bytesToHex(inner.sender) !== assembly.sender ||
      inner.type !== type ||
      inner.timestamp !== assembly.timestamp ||
      !isMeshBroadcast(inner)
    ) {
      throw new Error("Bluetooth fragment envelope mismatch");
    }
    return { ...inner, ttl: Math.min(inner.ttl, assembly.ttl) };
  }

  const maintenance = setInterval(() => {
    if (disposed) return;
    const now = Date.now();
    expirePeers(now);
    for (const [id, pin] of signingPins) {
      if (pin.expiresAt <= now) signingPins.delete(id);
    }
    for (const [key, assembly] of assemblies) {
      if (now - assembly.createdAt > 30_000) assemblies.delete(key);
    }
    for (const [key, at] of seen) {
      if (now - at > 6 * 60 * 60 * 1000) seen.delete(key);
    }
    for (let index = unknownMessages.length - 1; index >= 0; index--) {
      if (now - unknownMessages[index].at > 5000)
        unknownMessages.splice(index, 1);
    }
    announce();
  }, 15_000);

  return {
    ownPeerId,
    get noisePublicKey() {
      return new Uint8Array(noisePublicKey);
    },
    get signingPublicKey() {
      return new Uint8Array(signingPublicKey);
    },
    connect(linkId, maxPacketSize) {
      if (disposed) return;
      if (!Number.isInteger(maxPacketSize) || maxPacketSize < 36) {
        report(
          new Error("Bluetooth peer needs a larger negotiated packet size"),
        );
        return;
      }
      const existing = links.get(linkId);
      if (existing) existing.maxPacketSize = Math.min(maxPacketSize, 512);
      else if (links.size < MAX_LINKS)
        links.set(linkId, {
          maxPacketSize: Math.min(maxPacketSize, 512),
          tail: Promise.resolve(),
          queued: 0,
        });
      else {
        report(new Error("Bluetooth connection limit reached"));
        return;
      }
      announce(linkId);
    },
    disconnect(linkId) {
      links.delete(linkId);
      for (const state of peers.values()) {
        if (state.peer.directLinkIds.includes(linkId)) {
          state.peer.directLinkIds = state.peer.directLinkIds.filter(
            (id) => id !== linkId,
          );
          publishPeer(state);
        }
      }
    },
    receive(linkId, bytes) {
      if (disposed || !links.has(linkId)) return Promise.resolve();
      if (
        bytes.length > MAX_PACKET_BYTES ||
        queuedReceives >= MAX_QUEUED_PACKETS
      ) {
        report(
          new Error("Bluetooth receive queue is full or packet is too large"),
        );
        return Promise.resolve();
      }
      const copy = new Uint8Array(bytes);
      queuedReceives++;
      const operation = receiveTail.then(async () => {
        if (!disposed)
          await processPacket(await decodeMeshPacket(copy), linkId);
      });
      receiveTail = operation.catch(report).finally(() => {
        queuedReceives--;
      });
      return receiveTail;
    },
    async sendMessage(text) {
      if (disposed || !links.size)
        throw new Error("No Bluetooth peers connected");
      const payload = meshUtf8(text.trim());
      if (!payload.length) throw new Error("Bluetooth message is empty");
      // Swift re-compresses signature preimages above 99 bytes with Apple's compressor.
      if (payload.length > MAX_MESSAGE_BYTES)
        throw new Error(
          `Bluetooth messages support at most ${MAX_MESSAGE_BYTES} UTF-8 bytes`,
        );
      const packet = createPacket(MESSAGE, payload);
      markSeen(packet);
      const delivered = await broadcast(packet);
      if (disposed) throw new Error("Bluetooth chat stopped");
      if (!delivered) throw new Error("Bluetooth message could not be sent");
      options.onMessage({
        id: meshMessageId(packet),
        peerId: ownPeerId,
        nickname,
        text: meshText(payload),
        timestamp: packet.timestamp,
        own: true,
      });
    },
    setNickname(value) {
      const normalized = normalizeMeshNickname(
        value,
        `linky_${ownPeerId.slice(0, 4)}`,
      );
      if (normalized === nickname) return;
      nickname = normalized;
      announce();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearInterval(maintenance);
      for (const timer of relays) clearTimeout(timer);
      relays.clear();
      links.clear();
      peers.clear();
      signingPins.clear();
      seen.clear();
      assemblies.clear();
      unknownMessages.length = 0;
      signingKey.fill(0);
    },
  };
}
