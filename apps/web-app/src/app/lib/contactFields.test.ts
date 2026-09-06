import { describe, expect, it } from "vitest";
import { toContactTextFields, toEvoluText } from "./contactFields";

describe("contact field conversion", () => {
  it("trims contact text and preserves the length boundary", () => {
    expect(toEvoluText(" Alice ")).toBe("Alice");
    expect(toEvoluText("a".repeat(1000))).toHaveLength(1000);
    expect(toEvoluText("a".repeat(1001))).toBeNull();
    expect(toEvoluText("   ")).toBeNull();
    expect(toEvoluText(undefined)).toBeNull();
  });

  it("converts imported and migrated contact fields consistently", () => {
    expect(
      toContactTextFields({
        name: " Alice ",
        npub: " npub1example ",
        lnAddress: " alice@example.com ",
        groupName: " friends ",
        groupNamesJson: ' ["friends"] ',
      }),
    ).toEqual({
      name: "Alice",
      npub: "npub1example",
      lnAddress: "alice@example.com",
      groupName: "friends",
      groupNamesJson: '["friends"]',
    });
    expect(toContactTextFields({})).toEqual({
      name: null,
      npub: null,
      lnAddress: null,
      groupName: null,
      groupNamesJson: null,
    });
  });
});
