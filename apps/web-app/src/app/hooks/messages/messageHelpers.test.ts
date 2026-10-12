import {
  derivePubkey,
  encodeNprofile,
  NostrSecretKey,
} from "@linky-fit/linkstr";
import { describe, expect, it } from "vitest";
import { buildCashuPaymentRequestMessage } from "../../lib/paymentRequestMessage";
import type { LocalNostrMessage } from "../../types/appTypes";
import {
  dedupeChatMessages,
  dedupeNostrMessagesByPriority,
} from "./messageHelpers";

const makeMessage = (
  id: string,
  overrides?: Partial<LocalNostrMessage>,
): LocalNostrMessage => ({
  id,
  contactId: "contact-1",
  content: `message-${id}`,
  createdAtSec: Number(id) || 1,
  direction: "in",
  pubkey: "pub-1",
  rumorId: `rumor-${id}`,
  wrapId: `wrap-${id}`,
  ...overrides,
});

describe("dedupeNostrMessagesByPriority", () => {
  it("prefers wrap-id identity over client-id and rumor fallback", () => {
    const deduped = dedupeNostrMessagesByPriority([
      makeMessage("1", {
        wrapId: "wrap-fixed",
        clientId: "client-fixed",
        rumorId: "rumor-fixed",
      }),
      makeMessage("2", {
        wrapId: "wrap-fixed",
        rumorId: "rumor-other",
      }),
      makeMessage("3", {
        wrapId: "wrap-other",
        clientId: "client-fixed",
        rumorId: "rumor-third",
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.wrapId).toBe("wrap-fixed");
    expect(deduped[0]?.clientId).toBe("client-fixed");
  });

  it("keeps a deletion when its row merges with an undeleted copy", () => {
    const deduped = dedupeNostrMessagesByPriority([
      makeMessage("1"),
      makeMessage("2", {
        content: "[deleted]",
        deletedAtSec: 2,
        rumorId: "rumor-1",
        wrapId: "rumor-1",
      }),
    ]);

    expect(deduped).toEqual([
      expect.objectContaining({ content: "[deleted]", deletedAtSec: 2 }),
    ]);
  });

  it("keeps a deletion of a duplicate the merge drops", () => {
    const deduped = dedupeNostrMessagesByPriority([
      makeMessage("1", { clientId: "client-1", rumorId: "rumor-a" }),
      makeMessage("2", {
        clientId: "client-1",
        content: "[deleted]",
        deletedAtSec: 2,
        rumorId: "rumor-b",
        wrapId: "rumor-b",
      }),
    ]);

    expect(deduped).toEqual([
      expect.objectContaining({
        content: "[deleted]",
        deletedAtSec: 2,
        rumorId: "rumor-a",
      }),
    ]);
  });

  it("applies a deletion naming a duplicate the merge dropped earlier", () => {
    const deduped = dedupeNostrMessagesByPriority([
      makeMessage("1", { clientId: "client-1", rumorId: "rumor-a" }),
      makeMessage("2", { clientId: "client-1", rumorId: "rumor-b" }),
      makeMessage("3", {
        content: "[deleted]",
        deletedAtSec: 3,
        rumorId: "rumor-b",
        wrapId: "rumor-b",
      }),
    ]);

    expect(deduped).toEqual([
      expect.objectContaining({ content: "[deleted]", deletedAtSec: 3 }),
    ]);
  });

  it("drops a deletion of a message carrying a payment", () => {
    const request = buildCashuPaymentRequestMessage({
      amount: 21,
      mintUrls: [],
      recipientNprofile: encodeNprofile(
        derivePubkey(NostrSecretKey.make(new Uint8Array(32).fill(1))),
        [],
      ),
      requestId: "request-1",
    });
    const placeholder = (id: string, rumorId: string) =>
      makeMessage(id, {
        content: "[deleted]",
        deletedAtSec: 5,
        rumorId,
        wrapId: rumorId,
      });

    const deduped = dedupeNostrMessagesByPriority([
      makeMessage("1", { content: request, direction: "out" }),
      makeMessage("2", { content: request }),
      placeholder("3", "rumor-1"),
      placeholder("4", "rumor-2"),
    ]);

    expect(
      deduped.map(({ content, deletedAtSec }) => ({ content, deletedAtSec })),
    ).toEqual([
      { content: request, deletedAtSec: undefined },
      { content: request, deletedAtSec: undefined },
    ]);
  });

  it("shows an own message and a placeholder deleting it as one deleted message", () => {
    const deduped = dedupeNostrMessagesByPriority([
      makeMessage("1", {
        direction: "out",
        originalContent: "first draft",
        rumorId: "rumor-shared",
      }),
      makeMessage("2"),
      makeMessage("3", {
        content: "[deleted]",
        deletedAtSec: 3,
        rumorId: "rumor-shared",
        wrapId: "rumor-shared",
      }),
      makeMessage("4", { contactId: "contact-2", rumorId: "rumor-shared" }),
    ]);

    expect(
      deduped.map(({ id, content, deletedAtSec, originalContent }) => ({
        id,
        content,
        deletedAtSec,
        originalContent,
      })),
    ).toEqual([
      { id: "1", content: "[deleted]", deletedAtSec: 3, originalContent: null },
      {
        id: "2",
        content: "message-2",
        deletedAtSec: undefined,
        originalContent: undefined,
      },
      {
        id: "4",
        content: "message-4",
        deletedAtSec: undefined,
        originalContent: undefined,
      },
    ]);
  });
});

describe("dedupeChatMessages", () => {
  it("collapses a client id only within one conversation and direction", () => {
    const shared = { clientId: "client-fixed" };
    const deduped = dedupeChatMessages([
      makeMessage("1", shared),
      makeMessage("2", shared),
      makeMessage("3", { ...shared, contactId: "contact-2" }),
      makeMessage("4", { ...shared, direction: "out" }),
    ]);

    expect(deduped.map((message) => message.id)).toEqual(["1", "3", "4"]);
  });
});
