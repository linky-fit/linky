import { Option, Schema } from "effect";
import { nip19 } from "nostr-tools";
import type { Event } from "nostr-tools";
import { SimplePool } from "nostr-tools/pool";
import recommendedRelays from "../public/recommended-relays.json" with { type: "json" };
import { getNpubcashBaseUrl } from "./_npubcash.js";
import { safeFetch } from "./_safeFetch.js";

export interface SharedProfile {
  npub: string;
  name: string | null;
  picture: string | null;
  about: string | null;
  lightningAddress: string | null;
  /** The raw general status (kind 30315, `d=general`); the page parses it. */
  status: string | null;
}

const PROFILE_FETCH_TIMEOUT_MS = 2500;
const NIP05_NAME = /^[a-z0-9._-]{1,64}$/;
const FALLBACK_IMAGE_URL = "https://app.linky.fit/pwa-512x512.png";
// Linky stores a photo the user takes or uploads in the profile as a JPEG data URL.
const DATA_IMAGE =
  /^data:(image\/(?:jpeg|png|webp|gif));base64,([a-z0-9+/]+=*)$/i;

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
    lud16: Schema.optional(Schema.Unknown),
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

const isExpired = (event: Event): boolean => {
  const expiration = Number(
    event.tags.find(([name]) => name === "expiration")?.[1],
  );
  return expiration > 0 && expiration * 1000 <= Date.now();
};

const fetchProfileEvents = async (pubkey: string) => {
  const pool = new SimplePool();
  const params = { maxWait: PROFILE_FETCH_TIMEOUT_MS };
  try {
    return await Promise.all([
      pool.get(
        recommendedRelays.nostr,
        { kinds: [0], authors: [pubkey] },
        params,
      ),
      pool.get(
        recommendedRelays.nostr,
        { kinds: [30315], authors: [pubkey], "#d": ["general"] },
        params,
      ),
    ]);
  } finally {
    pool.destroy();
  }
};

export const loadSharedProfile = async (
  id: string,
): Promise<SharedProfile | null> => {
  const pubkey = await resolveProfilePubkey(id).catch(() => null);
  if (!pubkey) return null;
  const [profileEvent, statusEvent] = await fetchProfileEvents(pubkey).catch(
    () => [null, null],
  );
  const content = profileEvent
    ? Option.getOrNull(
        Schema.decodeUnknownOption(ProfileContent)(profileEvent.content),
      )
    : null;
  const picture = text(content?.picture);
  const showsPicture =
    picture?.startsWith("https://") || DATA_IMAGE.test(picture ?? "");
  return {
    npub: nip19.npubEncode(pubkey),
    name: text(content?.display_name) ?? text(content?.name),
    picture: showsPicture ? picture : null,
    about: text(content?.about),
    lightningAddress: text(content?.lud16),
    status:
      statusEvent && !isExpired(statusEvent) ? text(statusEvent.content) : null,
  };
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

/** The profile's data-URL picture as bytes, which `/p/<id>/picture` serves to link previews. */
export const loadProfilePicture = async (
  id: string,
): Promise<{ contentType: string; bytes: Buffer } | null> => {
  const profile = await loadSharedProfile(id);
  const match = DATA_IMAGE.exec(profile?.picture ?? "");
  return match
    ? { contentType: match[1], bytes: Buffer.from(match[2], "base64") }
    : null;
};

// Link previews render neither data URLs nor SVG, and Linky's generated avatars are DiceBear SVGs.
const previewImageUrl = (picture: string | null, pageUrl: string): string => {
  if (!picture) return FALLBACK_IMAGE_URL;
  if (picture.startsWith("data:")) return `${pageUrl}/picture`;
  return picture.startsWith("https://api.dicebear.com/")
    ? picture.replace(/\/svg(\?|$)/, "/png$1")
    : picture;
};

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
    "og:image": previewImageUrl(profile?.picture ?? null, pageUrl),
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
