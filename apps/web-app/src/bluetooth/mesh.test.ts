// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hexToBytes, bytesToHex } from "@noble/hashes/utils";
import { ed25519, x25519 } from "@noble/curves/ed25519";
import {
  createMeshSession,
  type MeshMessage,
  type MeshPeer,
  type MeshSession,
} from "./mesh";
import {
  decodeMeshAnnouncement,
  decodeMeshPacket,
  encodeMeshAnnouncement,
  encodeMeshPacket,
  fragmentMeshPacket,
  joinMeshBytes,
  MAX_MESSAGE_BYTES,
  meshPeerId,
  meshSigningBytes,
  meshText,
  meshUtf8,
  normalizeMeshNickname,
  signMeshPacket,
  verifyMeshPacket,
} from "./meshCodec";
import { swiftMeshVectors } from "./meshFixtures";

const publicKey = hexToBytes(swiftMeshVectors.SIGNING);
const longText =
  "This is a fairly normal message with enough characters to compress. Perhaps we should compare several sentences and repeat the earlier normal message with enough characters to compress.";
const sessions: MeshSession[] = [];

function fixtureSession() {
  const messages: MeshMessage[] = [];
  const peers: MeshPeer[] = [];
  const frames: { linkId: string; bytes: Uint8Array }[] = [];
  const errors: string[] = [];
  const session = createMeshSession({
    signingKey: new Uint8Array(32).fill(11),
    noiseKey: new Uint8Array(32).fill(12),
    nickname: "Linky Dave",
    send: (linkId, bytes) => {
      frames.push({ linkId, bytes });
    },
    onMessage: (message) => {
      messages.push(message);
    },
    onPeer: (peer) => {
      peers.push(peer);
    },
    onError: (error) => {
      errors.push(error);
    },
  });
  sessions.push(session);
  session.connect("radio-a", 512);
  return { session, messages, peers, frames, errors };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_010);
});

afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
  vi.useRealTimers();
});

describe("BitChat wire compatibility", () => {
  it("verifies independent Swift announcements and derives their identity", async () => {
    const packet = await decodeMeshPacket(
      hexToBytes(swiftMeshVectors.ANNOUNCE),
    );
    const announcement = decodeMeshAnnouncement(packet.payload);
    expect(announcement.nickname).toBe("Swift peer");
    expect(meshPeerId(announcement.noisePublicKey)).toBe(
      swiftMeshVectors.SENDER,
    );
    expect(bytesToHex(announcement.signingPublicKey)).toBe(
      swiftMeshVectors.SIGNING,
    );
    expect(verifyMeshPacket(packet, publicKey)).toBe(true);
    expect(bytesToHex(encodeMeshPacket(packet))).toBe(
      swiftMeshVectors.ANNOUNCE,
    );
    expect(encodeMeshAnnouncement(announcement)).toEqual(packet.payload);
  });

  it("verifies Swift public-message signatures with unsigned TTL and padded preimages", async () => {
    const packet = await decodeMeshPacket(hexToBytes(swiftMeshVectors.MESSAGE));
    expect(meshText(packet.payload)).toBe("Hello Linky 👋");
    expect(meshSigningBytes(packet)).toHaveLength(256);
    expect(verifyMeshPacket(packet, publicKey)).toBe(true);
    expect(verifyMeshPacket({ ...packet, ttl: 2 }, publicKey)).toBe(true);
    const tampered = hexToBytes(swiftMeshVectors.MESSAGE);
    tampered[23] ^= 1;
    expect(verifyMeshPacket(await decodeMeshPacket(tampered), publicKey)).toBe(
      false,
    );
  });

  it("decodes Apple's raw DEFLATE and preserves its signed wire bytes", async () => {
    const packet = await decodeMeshPacket(
      hexToBytes(swiftMeshVectors.COMPRESSED),
    );
    expect(packet.compressed).toBe(true);
    expect(meshText(packet.payload)).toBe(longText);
    expect(verifyMeshPacket(packet, publicKey)).toBe(true);
    expect(bytesToHex(encodeMeshPacket(packet))).toBe(
      swiftMeshVectors.COMPRESSED,
    );
    expect(verifyMeshPacket({ ...packet, ttl: 3 }, publicKey)).toBe(true);
  });

  it("handles the v2 length field and source route without changing signatures", async () => {
    const packet = await decodeMeshPacket(
      hexToBytes(swiftMeshVectors.ROUTED_V2),
    );
    expect(packet.version).toBe(2);
    expect(packet.route).toEqual([new Uint8Array(8).fill(3)]);
    expect(meshText(packet.payload)).toBe("route testing");
    expect(verifyMeshPacket(packet, publicKey)).toBe(true);
    expect(bytesToHex(encodeMeshPacket(packet))).toBe(
      swiftMeshVectors.ROUTED_V2,
    );
  });

  it("rejects truncated, malformed and decompression-overflow frames", async () => {
    const packet = hexToBytes(swiftMeshVectors.ANNOUNCE);
    await expect(decodeMeshPacket(packet.slice(0, -1))).rejects.toThrow(
      "Truncated",
    );
    const version = new Uint8Array(packet);
    version[0] = 3;
    await expect(decodeMeshPacket(version)).rejects.toThrow("version");
    await expect(
      decodeMeshPacket(joinMeshBytes([packet, new Uint8Array([42])])),
    ).rejects.toThrow("padding");
    const compressed = hexToBytes(swiftMeshVectors.COMPRESSED);
    compressed[22] = 0;
    compressed[23] = 2;
    await expect(decodeMeshPacket(compressed)).rejects.toThrow("exceeds");
    const announcement = await decodeMeshPacket(packet);
    expect(() =>
      decodeMeshAnnouncement(
        joinMeshBytes([announcement.payload, new Uint8Array([1, 0])]),
      ),
    ).toThrow("field");
  });

  it("normalizes nicknames and limits bytes without splitting Unicode", () => {
    expect(normalizeMeshNickname("  @Da\u0301ve Smith#  ")).toBe("Dáve_Smith");
    expect(normalizeMeshNickname("😀".repeat(20))).toBe("😀".repeat(6));
    expect(normalizeMeshNickname("\u0000@#", "linky_1234")).toBe("linky_1234");
  });
});

describe("public mesh session", () => {
  it("receives signed BitChat messages, deduplicates relays and clears direct peers on disconnect", async () => {
    const { session, messages, peers, errors } = fixtureSession();
    await session.receive("radio-a", hexToBytes(swiftMeshVectors.ANNOUNCE));
    await session.receive("radio-a", hexToBytes(swiftMeshVectors.MESSAGE));
    await session.receive("radio-a", hexToBytes(swiftMeshVectors.MESSAGE));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      text: "Hello Linky 👋",
      nickname: "Swift peer",
      own: false,
    });
    expect(peers.at(-1)?.directLinkIds).toEqual(["radio-a"]);
    session.disconnect("radio-a");
    expect(peers.at(-1)?.directLinkIds).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("reassembles independent Swift fragments out of order and verifies the inner signature", async () => {
    const { session, messages, errors } = fixtureSession();
    await session.receive("radio-a", hexToBytes(swiftMeshVectors.ANNOUNCE));
    for (const frame of [
      swiftMeshVectors.FRAGMENT_2,
      swiftMeshVectors.FRAGMENT_0,
      swiftMeshVectors.FRAGMENT_2,
      swiftMeshVectors.FRAGMENT_3,
      swiftMeshVectors.FRAGMENT_1,
    ]) {
      await session.receive("radio-a", hexToBytes(frame));
    }
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe(longText);
    expect(errors).toEqual([]);
  });

  it("handles messages arriving before their announcement without letting a forged message block the valid one", async () => {
    const { session, messages, errors } = fixtureSession();
    const forged = hexToBytes(swiftMeshVectors.MESSAGE);
    forged[23] ^= 1;
    await session.receive("radio-a", forged);
    await session.receive("radio-a", hexToBytes(swiftMeshVectors.MESSAGE));
    expect(messages).toHaveLength(0);
    await session.receive("radio-a", hexToBytes(swiftMeshVectors.ANNOUNCE));
    expect(messages).toHaveLength(1);
    expect(errors).toEqual(["Invalid Bluetooth message signature"]);
  });

  it("rejects conflicting fragment streams and a reassembled message with a forged signature", async () => {
    const { session, messages, errors } = fixtureSession();
    await session.receive("radio-a", hexToBytes(swiftMeshVectors.ANNOUNCE));
    await session.receive("radio-a", hexToBytes(swiftMeshVectors.FRAGMENT_0));
    const conflicting = hexToBytes(swiftMeshVectors.FRAGMENT_0);
    conflicting[40] ^= 1;
    await session.receive("radio-a", conflicting);
    expect(errors.at(-1)).toContain("Conflicting");
    for (const frame of [
      swiftMeshVectors.FRAGMENT_0,
      swiftMeshVectors.FRAGMENT_1,
      swiftMeshVectors.FRAGMENT_2,
    ]) {
      await session.receive("radio-a", hexToBytes(frame));
    }
    const forgedSignature = hexToBytes(swiftMeshVectors.FRAGMENT_3);
    forgedSignature[forgedSignature.length - 1] ^= 1;
    await session.receive("radio-a", forgedSignature);
    expect(errors.at(-1)).toContain("signature");
    expect(messages).toHaveLength(0);
  });

  it("does not relay unverified messages and relays accepted messages with a lower TTL", async () => {
    const { session, frames, errors } = fixtureSession();
    session.connect("radio-b", 512);
    await session.receive("radio-a", hexToBytes(swiftMeshVectors.ANNOUNCE));
    await vi.advanceTimersByTimeAsync(150);
    frames.length = 0;
    const tampered = hexToBytes(swiftMeshVectors.MESSAGE);
    tampered[23] ^= 1;
    await session.receive("radio-a", tampered);
    await vi.advanceTimersByTimeAsync(150);
    expect(frames).toHaveLength(0);
    expect(errors.at(-1)).toContain("signature");
    await session.receive("radio-a", hexToBytes(swiftMeshVectors.MESSAGE));
    await vi.advanceTimersByTimeAsync(150);
    expect(frames).toHaveLength(1);
    expect(frames[0].linkId).toBe("radio-b");
    const relayed = await decodeMeshPacket(frames[0].bytes);
    expect(relayed.ttl).toBe(6);
    expect(verifyMeshPacket(relayed, publicKey)).toBe(true);
  });

  it("pins a peer's signing key and rejects stale packets", async () => {
    const { session, errors, messages } = fixtureSession();
    await session.receive("radio-a", hexToBytes(swiftMeshVectors.ANNOUNCE));
    const announcement = await decodeMeshPacket(
      hexToBytes(swiftMeshVectors.ANNOUNCE),
    );
    const replacementKey = new Uint8Array(32).fill(50);
    const identity = decodeMeshAnnouncement(announcement.payload);
    const payload = encodeMeshAnnouncement({
      ...identity,
      signingPublicKey: ed25519.getPublicKey(replacementKey),
    });
    const forged = signMeshPacket(
      {
        version: 1,
        type: 1,
        ttl: 7,
        timestamp: Date.now() + 1,
        sender: announcement.sender,
        payload,
      },
      replacementKey,
    );
    await session.receive("radio-a", encodeMeshPacket(forged));
    expect(errors.at(-1)).toContain("changed its signing key");
    vi.setSystemTime(Date.now() + 7 * 60 * 60 * 1000);
    await session.receive("radio-a", hexToBytes(swiftMeshVectors.MESSAGE));
    expect(errors.at(-1)).toContain("Stale");
    expect(messages).toEqual([]);
  });

  it("accepts newcomers after a full peer cache expires while retaining recent signing pins", async () => {
    const { session, peers, errors } = fixtureSession();
    const makeAnnouncement = (
      index: number,
      key = new Uint8Array(32).fill(7),
    ) => {
      const noiseKey = new Uint8Array(32).fill(3);
      noiseKey[1] = index & 255;
      noiseKey[2] = index >> 8;
      const noisePublicKey = x25519.getPublicKey(noiseKey);
      const packet = signMeshPacket(
        {
          version: 1,
          type: 1,
          ttl: 6,
          timestamp: Date.now(),
          sender: hexToBytes(meshPeerId(noisePublicKey)),
          payload: encodeMeshAnnouncement({
            nickname: `peer${index}`,
            noisePublicKey,
            signingPublicKey: ed25519.getPublicKey(key),
          }),
        },
        key,
      );
      return encodeMeshPacket(packet);
    };
    for (let index = 0; index < 256; index++) {
      await session.receive("radio-a", makeAnnouncement(index));
    }
    expect(peers.filter((peer) => peer.lastSeenAt > 0)).toHaveLength(256);
    await session.receive("radio-a", makeAnnouncement(256));
    expect(errors.at(-1)).toBe("Bluetooth mesh peer limit reached");
    await vi.advanceTimersByTimeAsync(45_000);
    expect(peers.filter((peer) => peer.lastSeenAt === 0)).toHaveLength(256);
    await session.receive("radio-a", makeAnnouncement(256));
    expect(peers.at(-1)?.nickname).toBe("peer256");
    expect(peers.at(-1)?.lastSeenAt).toBe(Date.now());
    await session.receive(
      "radio-a",
      makeAnnouncement(0, new Uint8Array(32).fill(55)),
    );
    expect(errors.at(-1)).toBe("Bluetooth peer changed its signing key");
    await session.receive("radio-a", makeAnnouncement(0));
    expect(peers.at(-1)?.nickname).toBe("peer0");
  });

  it("removes signed departures and expires their session-only signing pin after fifteen minutes", async () => {
    const { session, peers, errors } = fixtureSession();
    const original = await decodeMeshPacket(
      hexToBytes(swiftMeshVectors.ANNOUNCE),
    );
    await session.receive("radio-a", hexToBytes(swiftMeshVectors.ANNOUNCE));
    const leave = signMeshPacket(
      {
        version: 1,
        type: 3,
        ttl: 7,
        timestamp: Date.now(),
        sender: original.sender,
        payload: new Uint8Array(),
      },
      new Uint8Array(32).fill(7),
    );
    await session.receive("radio-a", encodeMeshPacket(leave));
    expect(peers.at(-1)).toMatchObject({ lastSeenAt: 0, directLinkIds: [] });
    const replacement = new Uint8Array(32).fill(55);
    const identity = decodeMeshAnnouncement(original.payload);
    const reannounce = () =>
      encodeMeshPacket(
        signMeshPacket(
          {
            version: 1,
            type: 1,
            ttl: 7,
            timestamp: Date.now(),
            sender: original.sender,
            payload: encodeMeshAnnouncement({
              ...identity,
              signingPublicKey: ed25519.getPublicKey(replacement),
            }),
          },
          replacement,
        ),
      );
    await session.receive("radio-a", reannounce());
    expect(errors.at(-1)).toBe("Bluetooth peer changed its signing key");
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    await session.receive("radio-a", reannounce());
    expect(peers.at(-1)?.lastSeenAt).toBe(Date.now());
    expect(peers.at(-1)?.directLinkIds).toEqual(["radio-a"]);
  });

  it("sends signed text and enforces the UTF-8 compatibility budget", async () => {
    const { session, messages, frames } = fixtureSession();
    await session.sendMessage("Ahoj 😀");
    const frame = frames.at(-1);
    expect(frame).toBeDefined();
    if (!frame) throw new Error("Missing sent message");
    const packet = await decodeMeshPacket(frame.bytes);
    expect(verifyMeshPacket(packet, session.signingPublicKey)).toBe(true);
    expect(messages[0]).toMatchObject({
      own: true,
      text: "Ahoj 😀",
      nickname: "Linky_Dave",
    });
    await expect(session.sendMessage("é".repeat(50))).rejects.toThrow(
      `${MAX_MESSAGE_BYTES}`,
    );
    expect(messages).toHaveLength(1);
    expect(meshUtf8("é".repeat(50))).toHaveLength(100);
  });

  it("negotiates small packet capacity, expires presence and stops when disposed", async () => {
    const { session, frames, peers, errors } = fixtureSession();
    session.connect("small", 20);
    expect(errors.at(-1)).toContain("larger negotiated packet size");
    await session.receive("radio-a", hexToBytes(swiftMeshVectors.ANNOUNCE));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(peers.at(-1)?.directLinkIds).toEqual([]);
    session.dispose();
    const count = frames.length;
    await vi.advanceTimersByTimeAsync(60_000);
    await session.receive("radio-a", hexToBytes(swiftMeshVectors.MESSAGE));
    expect(frames).toHaveLength(count);
    await expect(session.sendMessage("stopped")).rejects.toThrow();
  });

  it("fragments outbound packets within the negotiated frame budget", async () => {
    const packet = await decodeMeshPacket(
      hexToBytes(swiftMeshVectors.ANNOUNCE),
    );
    const frames = fragmentMeshPacket(packet, 64);
    expect(frames.length).toBeGreaterThan(1);
    expect(frames.every((frame) => frame.length <= 64)).toBe(true);
    const decoded = await Promise.all(frames.map(decodeMeshPacket));
    expect(decoded.every((frame) => frame.type === 32)).toBe(true);
    expect(
      joinMeshBytes(decoded.map((frame) => frame.payload.slice(13))),
    ).toEqual(encodeMeshPacket(packet));
  });
});
