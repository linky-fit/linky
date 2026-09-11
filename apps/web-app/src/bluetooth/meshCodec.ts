import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

// Wire format follows BitChat's Unlicense BitFoundation at 9b84b361.
export const MAX_PACKET_BYTES = 65_535;
export const MESH_TTL = 7;
export const MAX_MESSAGE_BYTES = 99;
export const MAX_NICKNAME_BYTES = 25;

export interface MeshPacket {
  version: 1 | 2;
  type: number;
  ttl: number;
  timestamp: number;
  sender: Uint8Array;
  recipient?: Uint8Array;
  route?: Uint8Array[];
  payload: Uint8Array;
  signature?: Uint8Array;
  compressed?: boolean;
  wirePayload?: Uint8Array;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export const meshUtf8 = (value: string): Uint8Array => encoder.encode(value);
export const meshText = (bytes: Uint8Array): string => decoder.decode(bytes);
export const meshPeerId = (noisePublicKey: Uint8Array): string =>
  bytesToHex(sha256(noisePublicKey).slice(0, 8));

export function normalizeMeshNickname(
  name: string,
  fallback = "linky",
): string {
  const clean = name
    .normalize("NFC")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/gu, "_")
    .replace(/[@#]/gu, "")
    .replace(/^_+|_+$/gu, "");
  let result = "";
  for (const character of clean) {
    if (meshUtf8(result + character).length > MAX_NICKNAME_BYTES) break;
    result += character;
  }
  return result || fallback;
}

export function joinMeshBytes(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    parts.reduce((size, part) => size + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function padForSigning(bytes: Uint8Array): Uint8Array {
  const target = [256, 512, 1024, 2048].find(
    (size) => size >= bytes.length + 16,
  );
  if (!target || target - bytes.length > 255) return bytes;
  return joinMeshBytes([
    bytes,
    new Uint8Array(target - bytes.length).fill(target - bytes.length),
  ]);
}

export function encodeMeshPacket(packet: MeshPacket): Uint8Array {
  const payload = packet.wirePayload ?? packet.payload;
  const route = packet.route ?? [];
  if (
    packet.sender.length !== 8 ||
    (packet.recipient && packet.recipient.length !== 8) ||
    (packet.signature && packet.signature.length !== 64) ||
    !Number.isSafeInteger(packet.timestamp) ||
    packet.timestamp < 0 ||
    !Number.isInteger(packet.ttl) ||
    packet.ttl < 0 ||
    packet.ttl > MESH_TTL ||
    payload.length > MAX_PACKET_BYTES ||
    route.length > MESH_TTL ||
    route.some((hop) => hop.length !== 8) ||
    (packet.version === 1 && route.length > 0)
  ) {
    throw new Error("Invalid Bluetooth mesh packet");
  }
  const header = new Uint8Array(packet.version === 1 ? 14 : 16);
  const view = new DataView(header.buffer);
  header[0] = packet.version;
  header[1] = packet.type;
  header[2] = packet.ttl;
  view.setBigUint64(3, BigInt(packet.timestamp));
  header[11] =
    (packet.recipient ? 1 : 0) |
    (packet.signature ? 2 : 0) |
    (packet.compressed ? 4 : 0) |
    (route.length ? 8 : 0);
  if (packet.version === 1) view.setUint16(12, payload.length);
  else view.setUint32(12, payload.length);
  return joinMeshBytes([
    header,
    packet.sender,
    ...(packet.recipient ? [packet.recipient] : []),
    ...(route.length ? [new Uint8Array([route.length]), ...route] : []),
    payload,
    ...(packet.signature ? [packet.signature] : []),
  ]);
}

export function meshSigningBytes(packet: MeshPacket): Uint8Array {
  const unsigned = { ...packet, ttl: 0 };
  delete unsigned.signature;
  return padForSigning(encodeMeshPacket(unsigned));
}

export function signMeshPacket(
  packet: MeshPacket,
  privateKey: Uint8Array,
): MeshPacket {
  return {
    ...packet,
    signature: ed25519.sign(meshSigningBytes(packet), privateKey),
  };
}

export function verifyMeshPacket(
  packet: MeshPacket,
  publicKey: Uint8Array,
): boolean {
  return (
    packet.signature !== undefined &&
    ed25519.verify(packet.signature, meshSigningBytes(packet), publicKey, {
      zip215: false,
    })
  );
}

async function inflateBounded(
  bytes: Uint8Array,
  expected: number,
): Promise<Uint8Array> {
  if (expected < 1 || expected > MAX_PACKET_BYTES) {
    throw new Error("Invalid Bluetooth mesh decompressed size");
  }
  // Apple COMPRESSION_ZLIB writes raw DEFLATE, without the zlib wrapper.
  const stream = new Blob([new Uint8Array(bytes)])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      length += result.value.length;
      if (length > expected) {
        await reader.cancel();
        throw new Error("Bluetooth mesh decompression exceeds declared size");
      }
      parts.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (length !== expected) throw new Error("Incomplete Bluetooth mesh payload");
  return joinMeshBytes(parts);
}

export async function decodeMeshPacket(bytes: Uint8Array): Promise<MeshPacket> {
  if (bytes.length < 22 || bytes.length > MAX_PACKET_BYTES) {
    throw new Error("Invalid Bluetooth mesh packet size");
  }
  const version = bytes[0];
  if (version !== 1 && version !== 2) {
    throw new Error("Unsupported Bluetooth mesh packet version");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const flags = bytes[11];
  if ((flags & ~31) !== 0 || (version === 1 && (flags & 8) !== 0)) {
    throw new Error("Unsupported Bluetooth mesh packet flags");
  }
  const timestamp = Number(view.getBigUint64(3));
  if (!Number.isSafeInteger(timestamp) || bytes[2] > MESH_TTL) {
    throw new Error("Invalid Bluetooth mesh timestamp or TTL");
  }
  const payloadLength = version === 1 ? view.getUint16(12) : view.getUint32(12);
  let offset = version === 1 ? 14 : 16;
  const take = (length: number): Uint8Array => {
    if (offset + length > bytes.length)
      throw new Error("Truncated Bluetooth mesh packet");
    const part = bytes.slice(offset, offset + length);
    offset += length;
    return part;
  };
  const sender = take(8);
  const recipient = flags & 1 ? take(8) : undefined;
  const route: Uint8Array[] = [];
  if (flags & 8) {
    const count = take(1)[0];
    if (count > MESH_TTL) throw new Error("Bluetooth mesh route is too long");
    for (let index = 0; index < count; index++) route.push(take(8));
  }
  const wirePayload = take(payloadLength);
  const signature = flags & 2 ? take(64) : undefined;
  const padding = bytes.length - offset;
  if (padding > 255 || bytes.slice(offset).some((byte) => byte !== padding)) {
    throw new Error("Invalid Bluetooth mesh padding");
  }
  const compressed = (flags & 4) !== 0;
  let payload = wirePayload;
  if (compressed) {
    const sizeBytes = version === 1 ? 2 : 4;
    if (wirePayload.length <= sizeBytes)
      throw new Error("Truncated compressed mesh payload");
    const sizeView = new DataView(wirePayload.buffer);
    const expected =
      version === 1 ? sizeView.getUint16(0) : sizeView.getUint32(0);
    payload = await inflateBounded(wirePayload.slice(sizeBytes), expected);
  }
  return {
    version,
    type: bytes[1],
    ttl: bytes[2],
    timestamp,
    sender,
    payload,
    wirePayload,
    compressed,
    ...(recipient ? { recipient } : {}),
    ...(route.length ? { route } : {}),
    ...(signature ? { signature } : {}),
  };
}

export interface MeshAnnouncement {
  nickname: string;
  noisePublicKey: Uint8Array;
  signingPublicKey: Uint8Array;
}

export function encodeMeshAnnouncement(
  announcement: MeshAnnouncement,
): Uint8Array {
  const name = meshUtf8(announcement.nickname);
  return joinMeshBytes([
    new Uint8Array([1, name.length]),
    name,
    new Uint8Array([2, 32]),
    announcement.noisePublicKey,
    new Uint8Array([3, 32]),
    announcement.signingPublicKey,
  ]);
}

export function decodeMeshAnnouncement(bytes: Uint8Array): MeshAnnouncement {
  let offset = 0;
  const fields = new Map<number, Uint8Array>();
  while (offset < bytes.length) {
    if (offset + 2 > bytes.length)
      throw new Error("Truncated Bluetooth announcement");
    const type = bytes[offset++];
    const length = bytes[offset++];
    if (offset + length > bytes.length || fields.has(type)) {
      throw new Error("Invalid Bluetooth announcement field");
    }
    fields.set(type, bytes.slice(offset, offset + length));
    offset += length;
  }
  const name = fields.get(1);
  const noisePublicKey = fields.get(2);
  const signingPublicKey = fields.get(3);
  if (
    !name ||
    noisePublicKey?.length !== 32 ||
    signingPublicKey?.length !== 32
  ) {
    throw new Error("Missing Bluetooth announcement identity");
  }
  return {
    nickname: meshText(name).normalize("NFC"),
    noisePublicKey,
    signingPublicKey,
  };
}

export const meshMessageId = (packet: MeshPacket): string =>
  bytesToHex(
    sha256(
      meshUtf8(
        `${bytesToHex(packet.sender)}|${packet.timestamp}|${meshText(packet.payload).trim()}`,
      ),
    ),
  ).slice(0, 32);

export const isMeshBroadcast = (packet: MeshPacket): boolean =>
  !packet.recipient || packet.recipient.every((byte) => byte === 255);

export function fragmentMeshPacket(
  packet: MeshPacket,
  maxPacketSize: number,
): Uint8Array[] {
  const bytes = encodeMeshPacket(packet);
  if (bytes.length <= maxPacketSize) return [bytes];
  const chunkSize = maxPacketSize - 35;
  const total = Math.ceil(bytes.length / chunkSize);
  if (chunkSize < 1 || total > 256)
    throw new Error("Bluetooth packet capacity is too small");
  const id = crypto.getRandomValues(new Uint8Array(8));
  const parts: Uint8Array[] = [];
  for (let index = 0; index < total; index++) {
    const header = new Uint8Array(13);
    const view = new DataView(header.buffer);
    header.set(id);
    view.setUint16(8, index);
    view.setUint16(10, total);
    header[12] = packet.type;
    parts.push(
      encodeMeshPacket({
        version: 1,
        type: 32,
        ttl: packet.ttl,
        sender: packet.sender,
        timestamp: packet.timestamp,
        payload: joinMeshBytes([
          header,
          bytes.slice(index * chunkSize, (index + 1) * chunkSize),
        ]),
      }),
    );
  }
  return parts;
}
