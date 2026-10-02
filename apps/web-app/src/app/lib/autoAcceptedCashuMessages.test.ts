import { beforeEach, describe, expect, it } from "vitest";
import {
  isCashuAutoAcceptResolved,
  markCashuAutoAcceptResolved,
} from "./autoAcceptedCashuMessages";

const message = (id: string, rumorId: string | null = null) => ({
  id,
  rumorId,
});

describe("autoAcceptedCashuMessages", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persists a resolved message and reports it across reads", () => {
    expect(isCashuAutoAcceptResolved(message("msg-1"))).toBe(false);
    markCashuAutoAcceptResolved(message("msg-1"));
    expect(isCashuAutoAcceptResolved(message("msg-1"))).toBe(true);
    expect(isCashuAutoAcceptResolved(message("msg-2"))).toBe(false);
  });

  it("knows a message by its rumor id whatever row holds it", () => {
    markCashuAutoAcceptResolved(message("row-on-this-device", "rumor-1"));
    expect(
      isCashuAutoAcceptResolved(message("row-synced-later", "rumor-1")),
    ).toBe(true);
  });

  it("still knows a message recorded by its row id", () => {
    localStorage.setItem(
      "linky.cashu.auto_accepted_message_ids.v1",
      JSON.stringify(["row-1"]),
    );
    expect(isCashuAutoAcceptResolved(message("row-1", "rumor-1"))).toBe(true);
  });

  it("ignores blank ids and is idempotent", () => {
    markCashuAutoAcceptResolved(message("   "));
    expect(isCashuAutoAcceptResolved(message(""))).toBe(false);
    markCashuAutoAcceptResolved(message("msg-1"));
    markCashuAutoAcceptResolved(message("msg-1"));
    expect(isCashuAutoAcceptResolved(message("msg-1"))).toBe(true);
  });

  it("keeps the newest entries when the bound is exceeded", () => {
    for (let i = 0; i < 1005; i += 1)
      markCashuAutoAcceptResolved(message(`msg-${i}`));
    expect(isCashuAutoAcceptResolved(message("msg-0"))).toBe(false);
    expect(isCashuAutoAcceptResolved(message("msg-1004"))).toBe(true);
  });
});
