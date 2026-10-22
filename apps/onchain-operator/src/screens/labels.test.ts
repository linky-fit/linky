import { describe, expect, it } from "vitest";
import { nut18Payload, testMint } from "../services/testing/fakes";
import { messageText } from "./labels";

describe("messageText", () => {
  it("flags ecash at another mint as paying no transfer", () => {
    expect(messageText(nut18Payload("transfer-1", 500), testMint)).toBe(
      "Cashu 500 sat for a transfer",
    );
    expect(
      messageText(
        nut18Payload("transfer-1", 500, "https://own.mint"),
        testMint,
      ),
    ).toBe(
      "Cashu 500 sat at https://own.mint: not the transfer mint's sats, so it pays no transfer",
    );
  });
});
