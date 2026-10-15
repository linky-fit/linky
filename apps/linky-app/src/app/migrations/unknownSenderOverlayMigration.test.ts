import { RumorId } from "@linky-fit/linkstr";
import { MessageId, nostrMessageIdFor } from "@linky-fit/linksync";
import { describe, expect, it } from "vitest";
import { UNKNOWN_CONTACT_ID_PREFIX } from "../../utils/constants";
import { overlayRowsToImport } from "./unknownSenderOverlayMigration";

const UNKNOWN_SENDER = "a1".repeat(32);
const BLOCKED = "b0".repeat(32);
const rumorId = RumorId.make("c".repeat(64));

const entry = (overrides: Record<string, unknown>) => ({
  id: "7f0c1d2e-local-id",
  contactId: `${UNKNOWN_CONTACT_ID_PREFIX}${UNKNOWN_SENDER}`,
  direction: "in",
  content: "hello",
  wrapId: rumorId,
  rumorId,
  pubkey: UNKNOWN_SENDER,
  createdAtSec: 100,
  status: "sent",
  ...overrides,
});

describe("overlayRowsToImport", () => {
  it("keys a message from Nostr by its rumor and leaves out blocked senders and unreadable entries", () => {
    const rows = overlayRowsToImport(
      [
        entry({}),
        entry({ contactId: `${UNKNOWN_CONTACT_ID_PREFIX}${BLOCKED}` }),
        entry({ contactId: "not-an-unknown-sender" }),
        entry({ content: "" }),
      ],
      (pubkey) => pubkey === BLOCKED,
    );
    expect(rows).toEqual([
      {
        id: nostrMessageIdFor(rumorId),
        peerPubkey: UNKNOWN_SENDER,
        direction: "in",
        content: "hello",
        wrapId: rumorId,
        rumorId,
        pubkey: UNKNOWN_SENDER,
        createdAtSec: 100,
        status: "sent",
      },
    ]);
  });

  it("gives a pending reply without a rumor a message id", () => {
    const [row] = overlayRowsToImport(
      [entry({ direction: "out", rumorId: null, wrapId: "pending:x" })],
      () => false,
    );
    expect(row && MessageId.fromUnknown(row.id).ok).toBe(true);
    expect(row?.direction).toBe("out");
  });
});
