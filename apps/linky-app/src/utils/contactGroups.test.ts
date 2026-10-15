import { describe, expect, it } from "vitest";
import {
  getContactGroups,
  normalizeContactGroups,
  serializeContactGroups,
} from "./contactGroups";

describe("contact groups", () => {
  it("reads legacy single-group contacts", () => {
    expect(getContactGroups({ groupName: " Rodina " })).toEqual(["Rodina"]);
  });

  it("reads multiple groups and removes case-insensitive duplicates", () => {
    expect(
      getContactGroups({
        groupName: "Rodina",
        groupNamesJson: '["Práce","rodina"]',
      }),
    ).toEqual(["Práce", "rodina"]);
  });

  it("round-trips normalized groups", () => {
    const groups = normalizeContactGroups([" Rodina ", "Práce", "rodina"]);
    expect(serializeContactGroups(groups)).toBe('["Rodina","Práce"]');
  });
});
