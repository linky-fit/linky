import { describe, expect, it } from "vitest";
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
