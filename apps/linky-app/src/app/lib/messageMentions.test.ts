import { describe, expect, it } from "vitest";
import {
  applyMessageMentionSuggestion,
  getMessageMentionQuery,
  getMessageMentionSuggestions,
  type MessageMentionContact,
} from "./messageMentions";

const contacts: MessageMentionContact[] = [
  {
    name: "Karel Novák",
    npub: "npub1karel",
    groupName: "Rodina",
    statusNames: ["BTC", "CZK"],
  },
  {
    name: "Karel Svoboda",
    npub: "npub1svoboda",
    groupName: "Práce",
    statusNames: ["BTC"],
  },
  {
    name: "Anna",
    npub: "npub1anna",
    groupName: "Rodina",
    statusNames: [],
  },
];

describe("message mentions", () => {
  it("finds a partial mention at the caret", () => {
    expect(getMessageMentionQuery("Ahoj @kar", 9)).toEqual({
      start: 5,
      end: 9,
      query: "kar",
    });
  });

  it("offers every matching contact and matching groups", () => {
    const contactMatches = getMessageMentionSuggestions(contacts, "karel");
    expect(contactMatches).toHaveLength(2);
    expect(contactMatches.every((item) => item.kind === "contact")).toBe(true);

    const groupMatches = getMessageMentionSuggestions(contacts, "rod");
    expect(groupMatches).toHaveLength(1);
    expect(groupMatches[0]?.kind).toBe("group");
  });

  it("expands a group to all unique npubs", () => {
    const mention = getMessageMentionQuery("Pro @rod díky", 8);
    const group = getMessageMentionSuggestions(contacts, "rod")[0];
    expect(mention).not.toBeNull();
    expect(group?.kind).toBe("group");
    if (!mention || !group || group.kind !== "group") return;

    expect(
      applyMessageMentionSuggestion("Pro @rod díky", mention, group),
    ).toEqual({
      caret: 25,
      value: "Pro npub1karel npub1anna  díky",
    });
  });

  it("excludes the message recipient from group suggestions only", () => {
    const suggestions = getMessageMentionSuggestions(
      contacts,
      "rod",
      "npub1karel",
    );
    const group = suggestions.find((suggestion) => suggestion.kind === "group");
    expect(group?.kind).toBe("group");
    if (!group || group.kind !== "group") return;

    expect(group.contacts.map((contact) => contact.npub)).toEqual([
      "npub1anna",
    ]);
    expect(
      getMessageMentionSuggestions(contacts, "karel", "npub1karel").some(
        (suggestion) =>
          suggestion.kind === "contact" &&
          suggestion.contact.npub === "npub1karel",
      ),
    ).toBe(true);
  });

  it("treats status currencies as contact groups", () => {
    const statusGroup = getMessageMentionSuggestions(contacts, "btc")[0];
    expect(statusGroup?.kind).toBe("group");
    if (!statusGroup || statusGroup.kind !== "group") return;
    expect(statusGroup.contacts.map((contact) => contact.name)).toEqual([
      "Karel Novák",
      "Karel Svoboda",
    ]);
  });
});
