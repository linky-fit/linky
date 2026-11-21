const MAX_TEXT_LENGTH = 1000;

export const toContactText = (
  value: string | null | undefined,
): string | null => {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 && trimmed.length <= MAX_TEXT_LENGTH
    ? trimmed
    : null;
};

interface ContactTextFields {
  name?: string | null | undefined;
  npub?: string | null | undefined;
  lnAddress?: string | null | undefined;
  groupName?: string | null | undefined;
  groupNamesJson?: string | null | undefined;
}

export const toContactTextFields = (contact: ContactTextFields) => ({
  name: toContactText(contact.name),
  npub: toContactText(contact.npub),
  lnAddress: toContactText(contact.lnAddress),
  groupName: toContactText(contact.groupName),
  groupNamesJson: toContactText(contact.groupNamesJson),
});
