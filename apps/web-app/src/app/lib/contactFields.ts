import { NonEmptyString1000 } from "@linky/linksync";

export const toEvoluText = (
  value: string | null | undefined,
): NonEmptyString1000 | null => {
  const parsed = NonEmptyString1000.fromUnknown((value ?? "").trim());
  return parsed.ok ? parsed.value : null;
};

interface ContactTextFields {
  name?: string | null | undefined;
  npub?: string | null | undefined;
  lnAddress?: string | null | undefined;
  groupName?: string | null | undefined;
  groupNamesJson?: string | null | undefined;
}

export const toContactTextFields = (contact: ContactTextFields) => ({
  name: toEvoluText(contact.name),
  npub: toEvoluText(contact.npub),
  lnAddress: toEvoluText(contact.lnAddress),
  groupName: toEvoluText(contact.groupName),
  groupNamesJson: toEvoluText(contact.groupNamesJson),
});
