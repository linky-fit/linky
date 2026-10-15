import { describe, expect, it } from "vitest";
import { getContactQueryPrefill } from "./contactQueryPrefill";

describe("getContactQueryPrefill", () => {
  it("puts a lightning-address-shaped query into the lightning field", () => {
    expect(getContactQueryPrefill(" alice@example.com ")).toEqual({
      lnAddress: "alice@example.com",
      name: "",
    });
  });

  it("keeps an ordinary query as the contact name", () => {
    expect(getContactQueryPrefill(" Alice ")).toEqual({
      lnAddress: "",
      name: "Alice",
    });
  });

  it("removes the optional lightning URI prefix", () => {
    expect(getContactQueryPrefill("lightning:alice@example.com")).toEqual({
      lnAddress: "alice@example.com",
      name: "",
    });
  });
});
