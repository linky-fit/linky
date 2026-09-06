import { describe, expect, it } from "vitest";
import type { LocalNostrMessage } from "../../types/appTypes";
import { dedupeNostrMessagesByPriority } from "./messageHelpers";

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
