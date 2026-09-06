import {
  OwnSeenReceiptConfirmed,
  Pubkey,
  RumorId,
  SeenReceiptReceived,
  UnixSeconds,
} from "@linky/linkstr";
import { getPublicKey } from "nostr-tools";
import { describe, expect, it, vi } from "vitest";
import { createSecretKey } from "../../../testUtils/nostrKeys";
import {
  applyOwnSeenReceiptConfirmed,
  applySeenReceiptReceived,
  resolvePeerSeenAdvance,
  type PeerSeenWindow,
  type SeenReceiptInboxContext,
} from "./seenReceiptInbox";

const peerPubkey = getPublicKey(createSecretKey(2));
const RECEIPT_ID = "b".repeat(64);
const NOW_SEC = 1_700_000_100;
const SINCE_SEC = 1_699_000_000;
const SEEN_UP_TO_SEC = 1_700_000_000;

const receiptReceived = (
  overrides: Partial<ConstructorParameters<typeof SeenReceiptReceived>[0]> = {},
): SeenReceiptReceived =>
  new SeenReceiptReceived({
    receiptId: RumorId.make(RECEIPT_ID),
    from: Pubkey.make(peerPubkey),
    sinceSec: UnixSeconds.make(SINCE_SEC),
    seenUpToSec: UnixSeconds.make(SEEN_UP_TO_SEC),
    sentAt: UnixSeconds.make(SEEN_UP_TO_SEC),
    ...overrides,
  });

const createContext = (
  overrides: Partial<SeenReceiptInboxContext> = {},
): SeenReceiptInboxContext => ({
  advanceContactPeerSeen: vi.fn(),
  findContactId: () => "contact-1",
  getPeerSeenWindow: () => null,
  identitySinceSec: null,
  isBlockedPubkey: () => false,
  nowSec: NOW_SEC,
  recordSentSeenReceipt: vi.fn(),
  ...overrides,
});

describe("resolvePeerSeenAdvance", () => {
  const incoming: PeerSeenWindow = {
    sinceSec: SINCE_SEC,
    seenUpToSec: SEEN_UP_TO_SEC,
  };

  it("accepts a first window unchanged", () => {
    expect(resolvePeerSeenAdvance(null, incoming, NOW_SEC)).toEqual(incoming);
  });

  it("advances only when seenUpToSec strictly increases", () => {
    const current = { sinceSec: SINCE_SEC, seenUpToSec: SEEN_UP_TO_SEC };
    expect(resolvePeerSeenAdvance(current, incoming, NOW_SEC)).toBeNull();
    expect(
      resolvePeerSeenAdvance(
        current,
        { ...incoming, seenUpToSec: SEEN_UP_TO_SEC + 1 },
        NOW_SEC,
      ),
    ).toEqual({ sinceSec: SINCE_SEC, seenUpToSec: SEEN_UP_TO_SEC + 1 });
  });

  it("is idempotent under replay of an already-applied window", () => {
    const applied = resolvePeerSeenAdvance(null, incoming, NOW_SEC);
    expect(applied).not.toBeNull();
    expect(resolvePeerSeenAdvance(applied, incoming, NOW_SEC)).toBeNull();
  });

  it("clamps a far-future cursor to now plus the margin", () => {
    const farFuture = { ...incoming, seenUpToSec: NOW_SEC + 10 * 24 * 3600 };
    expect(resolvePeerSeenAdvance(null, farFuture, NOW_SEC)).toEqual({
      sinceSec: SINCE_SEC,
      seenUpToSec: NOW_SEC + 24 * 3600,
    });
  });

  it("rejects a window emptied by the clamp", () => {
    const emptied = {
      sinceSec: NOW_SEC + 2 * 24 * 3600,
      seenUpToSec: NOW_SEC + 10 * 24 * 3600,
    };
    expect(resolvePeerSeenAdvance(null, emptied, NOW_SEC)).toBeNull();
  });
});

describe("applySeenReceiptReceived", () => {
  it("advances the contact's window", () => {
    const advanceContactPeerSeen = vi.fn();
    applySeenReceiptReceived(
      receiptReceived(),
      createContext({ advanceContactPeerSeen }),
    );
    expect(advanceContactPeerSeen).toHaveBeenCalledWith("contact-1", {
      sinceSec: SINCE_SEC,
      seenUpToSec: SEEN_UP_TO_SEC,
    });
  });

  it("drops receipts from blocked pubkeys", () => {
    const advanceContactPeerSeen = vi.fn();
    applySeenReceiptReceived(
      receiptReceived(),
      createContext({ advanceContactPeerSeen, isBlockedPubkey: () => true }),
    );
    expect(advanceContactPeerSeen).not.toHaveBeenCalled();
  });

  it("drops receipts from unknown contacts", () => {
    const advanceContactPeerSeen = vi.fn();
    applySeenReceiptReceived(
      receiptReceived(),
      createContext({ advanceContactPeerSeen, findContactId: () => null }),
    );
    expect(advanceContactPeerSeen).not.toHaveBeenCalled();
  });

  it("drops receipts sent before the identity cutoff", () => {
    const advanceContactPeerSeen = vi.fn();
    applySeenReceiptReceived(
      receiptReceived(),
      createContext({
        advanceContactPeerSeen,
        identitySinceSec: SEEN_UP_TO_SEC + 1,
      }),
    );
    expect(advanceContactPeerSeen).not.toHaveBeenCalled();
  });

  it("ignores a receipt behind the stored window", () => {
    const advanceContactPeerSeen = vi.fn();
    applySeenReceiptReceived(
      receiptReceived(),
      createContext({
        advanceContactPeerSeen,
        getPeerSeenWindow: () => ({
          sinceSec: SINCE_SEC,
          seenUpToSec: SEEN_UP_TO_SEC + 100,
        }),
      }),
    );
    expect(advanceContactPeerSeen).not.toHaveBeenCalled();
  });
});

describe("applyOwnSeenReceiptConfirmed", () => {
  it("seeds the sent map with the echoed cursor", () => {
    const recordSentSeenReceipt = vi.fn();
    applyOwnSeenReceiptConfirmed(
      new OwnSeenReceiptConfirmed({
        receiptId: RumorId.make(RECEIPT_ID),
        to: Pubkey.make(peerPubkey),
        sinceSec: UnixSeconds.make(SINCE_SEC),
        seenUpToSec: UnixSeconds.make(SEEN_UP_TO_SEC),
        clientId: null,
        sentAt: UnixSeconds.make(SEEN_UP_TO_SEC),
      }),
      createContext({ recordSentSeenReceipt }),
    );
    expect(recordSentSeenReceipt).toHaveBeenCalledWith(
      peerPubkey,
      SEEN_UP_TO_SEC,
    );
  });
});
