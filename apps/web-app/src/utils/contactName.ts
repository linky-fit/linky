import { formatShortNpub } from "./formatting";
import { normalizeProfileName } from "./profileName";

interface NamedContact {
  name?: string | null | undefined;
  nameSetByUser?: number | boolean | null | undefined;
  npub?: string | null | undefined;
}

export const hasLocalContactName = (contact: NamedContact): boolean =>
  contact.nameSetByUser === 1 || contact.nameSetByUser === true;

export const getContactName = (contact: NamedContact): string =>
  hasLocalContactName(contact) || !contact.npub
    ? (contact.name ?? "").trim()
    : normalizeProfileName(contact.name ?? "");

const collisionKey = (name: string): string =>
  normalizeProfileName(name)
    .replace(/\p{Default_Ignorable_Code_Point}/gu, "")
    .toLowerCase();

export const createContactNameFormatter = (
  contacts: readonly NamedContact[],
) => {
  const identitiesByName = new Map<string, Set<string>>();
  for (const contact of contacts) {
    const key = collisionKey(getContactName(contact));
    if (!key) continue;
    const identities = identitiesByName.get(key) ?? new Set<string>();
    identities.add(contact.npub ?? "");
    identitiesByName.set(key, identities);
  }
  return (contact: NamedContact): string => {
    const name = getContactName(contact);
    if (!name || hasLocalContactName(contact) || !contact.npub) return name;
    const hasCollision =
      (identitiesByName.get(collisionKey(name))?.size ?? 0) > 1;
    return hasCollision ? `${name} (${formatShortNpub(contact.npub)})` : name;
  };
};
