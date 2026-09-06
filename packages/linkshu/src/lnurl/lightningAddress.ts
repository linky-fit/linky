export const stripLightningPrefix = (value: string): string =>
  value
    .trim()
    .replace(/^lightning:/i, "")
    .trim();
export interface LightningAddressParts {
  readonly domain: string;
  readonly user: string;
}

export const splitLightningAddress = (
  value: string,
): LightningAddressParts | null => {
  const trimmed = value.trim();
  const atIndex = trimmed.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === trimmed.length - 1) return null;
  return {
    user: trimmed.slice(0, atIndex),
    domain: trimmed.slice(atIndex + 1),
  };
};
const LIGHTNING_ADDRESS_PATTERN = /^[^@\s/:]+@[^@\s/:?#\\%]+\.[^@\s/:?#\\%]+$/;
export const isLightningAddress = (value: string): boolean => {
  return LIGHTNING_ADDRESS_PATTERN.test(stripLightningPrefix(value));
};

export const getLightningAddressRequestUrl = (
  lightningAddress: string,
): string => {
  // LUD-16 usernames are lowercase-only and domains are case-insensitive;
  // servers reject mixed-case addresses (e.g. `Plex@21m.lol`) as not found.
  const parts = splitLightningAddress(stripLightningPrefix(lightningAddress));
  if (!parts) throw new Error("Invalid lightning address");
  const user = parts.user.toLowerCase();
  const domain = parts.domain.toLowerCase();

  // LNURL-pay well-known endpoint for lightning address.
  return `https://${domain}/.well-known/lnurlp/${encodeURIComponent(user)}`;
};
