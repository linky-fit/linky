import { describe, expect, it } from "vitest";
import { NPUB_CASH_SERVER_BASE_URL } from "./npubCashServer";

describe("NPUB_CASH_SERVER_BASE_URL", () => {
  it("points at Linky's hosted npub.cash-compatible server", () => {
    expect(NPUB_CASH_SERVER_BASE_URL).toBe("https://npub.linky.fit");
  });
});
