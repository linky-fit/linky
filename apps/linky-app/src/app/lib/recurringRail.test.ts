import { describe, expect, it } from "vitest";
import { pickRecurringRail, recurringRecipient } from "./recurringRail";

const both = { npub: "npub1bob", lnAddress: "bob@example.com" };

describe("pickRecurringRail", () => {
  it("prefers Cashu for a contact with an npub while paying with Cashu is on", () => {
    expect(pickRecurringRail(both, true)).toBe("cashu");
    expect(pickRecurringRail(both, false)).toBe("lightning");
  });

  it("refuses a contact it cannot pay", () => {
    expect(pickRecurringRail({ npub: "npub1bob" }, false)).toBeNull();
    expect(pickRecurringRail({ lnAddress: " " }, true)).toBeNull();
    expect(pickRecurringRail(undefined, true)).toBeNull();
  });
});

describe("recurringRecipient", () => {
  it("is the contact's address on the rail", () => {
    expect(recurringRecipient(both, "cashu")).toBe("npub1bob");
    expect(recurringRecipient(both, "lightning")).toBe("bob@example.com");
    expect(recurringRecipient({ npub: "npub1bob" }, "lightning")).toBeNull();
  });
});
