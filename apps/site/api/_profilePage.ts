import { Option, Schema } from "effect";
import { nip19 } from "nostr-tools";
import { SimplePool } from "nostr-tools/pool";
import recommendedRelays from "../public/recommended-relays.json" with { type: "json" };
import { getNpubcashBaseUrl } from "./_npubcash.js";
import { safeFetch } from "./_safeFetch.js";

export interface SharedProfile {
  npub: string;
  name: string | null;
  picture: string | null;
  about: string | null;
}

const PROFILE_FETCH_TIMEOUT_MS = 2500;
const NIP05_NAME = /^[a-z0-9._-]{1,64}$/;
const FALLBACK_IMAGE_URL = "https://app.linky.fit/pwa-512x512.png";

const Nip05Names = Schema.parseJson(
  Schema.Struct({
    names: Schema.Record({ key: Schema.String, value: Schema.String }),
  }),
);

const ProfileContent = Schema.parseJson(
  Schema.Struct({
    name: Schema.optional(Schema.Unknown),
    display_name: Schema.optional(Schema.Unknown),
    picture: Schema.optional(Schema.Unknown),
    about: Schema.optional(Schema.Unknown),
  }),
);

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const decodeNpub = (value: string): string | null => {
  try {
    const decoded = nip19.decode(value.toLowerCase());
    return decoded.type === "npub" ? decoded.data : null;
  } catch {
    return null;
  }
};

const lookupLinkyName = async (name: string): Promise<string | null> => {
  const url = new URL("/.well-known/nostr.json", getNpubcashBaseUrl());
  url.searchParams.set("name", name);
  const result = await safeFetch(url);
  if (result.status !== 200) return null;
  const names = Schema.decodeUnknownOption(Nip05Names)(result.text);
  return Option.getOrNull(names)?.names[name] ?? null;
};

/** Resolves the `/p/<id>` segment, an npub or a linky.fit name, to a pubkey. */
export const resolveProfilePubkey = async (
  id: string,
): Promise<string | null> => {
  const value = id.trim().toLowerCase();
  if (value.startsWith("npub1")) return decodeNpub(value);
  return NIP05_NAME.test(value) ? lookupLinkyName(value) : null;
};

const fetchProfileContent = async (pubkey: string) => {
  const pool = new SimplePool();
  try {
    const event = await pool.get(
      recommendedRelays.nostr,
      { kinds: [0], authors: [pubkey] },
      { maxWait: PROFILE_FETCH_TIMEOUT_MS },
    );
    return event
      ? Option.getOrNull(
          Schema.decodeUnknownOption(ProfileContent)(event.content),
        )
      : null;
  } finally {
    pool.destroy();
  }
};

export const loadSharedProfile = async (
  id: string,
): Promise<SharedProfile | null> => {
  const pubkey = await resolveProfilePubkey(id).catch(() => null);
  if (!pubkey) return null;
  const content = await fetchProfileContent(pubkey).catch(() => null);
  const picture = text(content?.picture);
  return {
    npub: nip19.npubEncode(pubkey),
    name: text(content?.display_name) ?? text(content?.name),
    picture: picture?.startsWith("https://") ? picture : null,
    about: text(content?.about),
  };
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

// Link previews don't render SVG, and Linky's generated avatars are DiceBear SVGs.
const previewImageUrl = (picture: string | null): string =>
  picture?.startsWith("https://api.dicebear.com/")
    ? picture.replace(/\/svg(\?|$)/, "/png$1")
    : (picture ?? FALLBACK_IMAGE_URL);

/** Puts the link-preview tags and the profile the page renders into the `/p/` page. */
export const renderProfilePage = (
  template: string,
  profile: SharedProfile | null,
  pageUrl: string,
): string => {
  const name = profile?.name ?? "Linky";
  const title = profile ? `${name} on Linky` : "Linky";
  const description = profile
    ? (profile.about ?? `Add ${name} on Linky to message and pay them.`)
    : "Linky connects people you care about with simple Bitcoin messaging and payments.";
  const meta = {
    "og:type": "profile",
    "og:site_name": "Linky",
    "og:title": title,
    "og:description": description.slice(0, 300),
    "og:image": previewImageUrl(profile?.picture ?? null),
    "og:url": pageUrl,
    "twitter:card": "summary",
  };
  const tags = Object.entries(meta)
    .map(
      ([property, content]) =>
        `<meta property="${property}" content="${escapeHtml(content)}" />`,
    )
    .join("\n    ");
  const data = JSON.stringify(profile).replaceAll("<", "\\u003c");
  return template
    .replace(
      /<title>[^<]*<\/title>/,
      () => `<title>${escapeHtml(title)}</title>`,
    )
    .replace(
      "</head>",
      () =>
        `    ${tags}\n    <script id="shared-profile" type="application/json">${data}</script>\n  </head>`,
    );
};
