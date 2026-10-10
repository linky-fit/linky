import recommendedRelays from "../../public/recommended-relays.json";

export const signerAppUrl = import.meta.env.VITE_LINKY_APP_URL || undefined;

/** Must equal an entry in the callbacks of the domain document, which the api derives the same way. */
export const callbackUrl = `${location.origin}/demo/auth/`;

const configuredRelays = (import.meta.env.VITE_NOSTR_RELAYS ?? "")
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);
const [firstRelay = "", ...otherRelays] =
  configuredRelays.length > 0 ? configuredRelays : recommendedRelays.nostr;

export const relays: [string, ...string[]] = [firstRelay, ...otherRelays];
