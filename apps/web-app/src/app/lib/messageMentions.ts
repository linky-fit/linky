export interface MessageMentionContact {
  groupName: string | null;
  groupNames?: readonly string[];
  name: string;
  npub: string;
  statusNames: string[];
}

interface MessageMentionQuery {
  end: number;
  query: string;
  start: number;
}

export type MessageMentionSuggestion =
  | {
      kind: "contact";
      contact: MessageMentionContact;
    }
  | {
      kind: "group";
      groupName: string;
      contacts: MessageMentionContact[];
    };

const normalizeSearchText = (value: string): string =>
  value.trim().toLocaleLowerCase();

export const getMessageMentionQuery = (
  value: string,
  caret: number,
): MessageMentionQuery | null => {
  const safeCaret = Math.max(0, Math.min(caret, value.length));
  const beforeCaret = value.slice(0, safeCaret);
  const match = beforeCaret.match(/(?:^|\s)@([^\s@]*)$/u);
  if (!match) return null;

  const query = match[1] ?? "";
  const start = safeCaret - query.length - 1;
  return { end: safeCaret, query, start };
};

export const getMessageMentionSuggestions = (
  contacts: readonly MessageMentionContact[],
  query: string,
  groupExcludedNpub?: string | null,
): MessageMentionSuggestion[] => {
  const normalizedQuery = normalizeSearchText(query);
  const matches = (value: string) =>
    !normalizedQuery || normalizeSearchText(value).includes(normalizedQuery);

  const contactSuggestions: MessageMentionSuggestion[] = contacts
    .filter((contact) => contact.name && contact.npub && matches(contact.name))
    .map((contact) => ({ kind: "contact", contact }));

  const contactsByGroup = new Map<string, MessageMentionContact[]>();
  for (const contact of contacts) {
    const referenceNames = [
      ...(contact.groupNames ?? [contact.groupName]),
      ...contact.statusNames,
    ];
    for (const referenceName of referenceNames) {
      const groupName = (referenceName ?? "").trim();
      if (!groupName || !contact.npub || !matches(groupName)) continue;
      if (contact.npub === groupExcludedNpub) continue;
      const existing = contactsByGroup.get(groupName) ?? [];
      if (!existing.some((candidate) => candidate.npub === contact.npub)) {
        existing.push(contact);
      }
      contactsByGroup.set(groupName, existing);
    }
  }

  const groupSuggestions: MessageMentionSuggestion[] = Array.from(
    contactsByGroup.entries(),
  )
    .sort((left, right) => {
      if (right[1].length !== left[1].length) {
        return right[1].length - left[1].length;
      }
      return left[0].localeCompare(right[0]);
    })
    .map(([groupName, groupContacts]) => ({
      kind: "group",
      groupName,
      contacts: groupContacts,
    }));

  return [...groupSuggestions, ...contactSuggestions].slice(0, 8);
};

export const applyMessageMentionSuggestion = (
  value: string,
  mention: MessageMentionQuery,
  suggestion: MessageMentionSuggestion,
): { caret: number; value: string } => {
  const npubs =
    suggestion.kind === "contact"
      ? [suggestion.contact.npub]
      : suggestion.contacts.map((contact) => contact.npub);
  const replacement = `${Array.from(new Set(npubs)).join(" ")} `;
  const nextValue = `${value.slice(0, mention.start)}${replacement}${value.slice(
    mention.end,
  )}`;
  return {
    caret: mention.start + replacement.length,
    value: nextValue,
  };
};
