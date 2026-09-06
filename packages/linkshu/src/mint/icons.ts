const GENERIC_MINT_ICON_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='%2314b8a6'/><stop offset='100%' stop-color='%230ea5e9'/></linearGradient></defs><rect width='64' height='64' rx='32' fill='url(%23g)'/><path d='M21 44V20h6l5 10 5-10h6v24h-5V29l-4.5 8h-3L26 29v15z' fill='white'/></svg>";

export const GENERIC_MINT_ICON_DATA_URL = `data:image/svg+xml,${GENERIC_MINT_ICON_SVG}`;

export const getMintIconOverride = (host: string | null) => {
  if (!host) return null;
  const key = host.toLowerCase();
  if (key === "cashu.cz") {
    return "https://cashu.cz/icon.webp";
  }
  if (key === "testnut.cashu.space") {
    return "https://image.nostr.build/46ee47763c345d2cfa3317f042d332003f498ee281fb42808d47a7d3b9585911.png";
  }
  if (key === "mint.minibits.cash") {
    return "https://play-lh.googleusercontent.com/raLGxOOzbxOsEx25gr-rISzJOdbgVPG11JHuI2yV57TxqPD_fYBof9TRh-vUE-XyhgmN=w40-h480-rw";
  }
  if (key === "linky.cashu.cz") {
    return "https://linky-weld.vercel.app/icon.svg";
  }
  if (key === "kashu.me") {
    return "https://image.nostr.build/ca72a338d053ffa0f283a1399ebc772bef43814e4998c1fff8aa143b1ea6f29e.jpg";
  }
  if (key === "cashu.21m.lol") {
    return "https://em-content.zobj.net/source/apple/391/zany-face_1f92a.png";
  }
  return null;
};

type MintInfoSearchPrimitive = boolean | number | string | null | undefined;

interface MintInfoSearchObject {
  [key: string]: MintInfoSearchValue;
}

type MintInfoSearchValue =
  | MintInfoSearchObject
  | MintInfoSearchPrimitive
  | MintInfoSearchValue[];

const MINT_INFO_ICON_KEYS = [
  "icon_url",
  "iconUrl",
  "icon",
  "logo",
  "image",
  "image_url",
  "imageUrl",
];

const isSearchableMintInfoValue = (
  value: unknown,
): value is MintInfoSearchObject | MintInfoSearchValue[] => {
  return typeof value === "object" && value !== null;
};

export const findMintInfoIconValue = (
  value: unknown,
  seen: Set<MintInfoSearchObject | MintInfoSearchValue[]>,
): string | null => {
  if (!isSearchableMintInfoValue(value)) return null;
  if (seen.has(value)) return null;
  seen.add(value);

  if (!Array.isArray(value)) {
    for (const key of MINT_INFO_ICON_KEYS) {
      const rawValue = value[key];
      if (typeof rawValue !== "string") continue;
      const trimmed = rawValue.trim();
      if (trimmed) return trimmed;
    }
  }

  for (const inner of Object.values(value)) {
    const found = findMintInfoIconValue(inner, seen);
    if (found) return found;
  }

  return null;
};

export const isTestMintUrl = (mint: string): boolean => {
  try {
    const host = new URL(mint).hostname.toLowerCase();
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "testnut.cashu.space"
    );
  } catch {
    return false;
  }
};
