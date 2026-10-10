import { Schema } from "effect";
import { readJson, writeJson, type KeyValueStorage } from "./keyValueStorage";
import type { LinkyEvoluEvent } from "./linkyEvolu";

// Relays the user added; the recommended relays are always configured on top.
const USER_RELAYS_KEY = "linky.evoluServers.user.v1";

// Pre-recommendation storage, read once to migrate it into the user relays.
const LEGACY_RELAYS_KEY = "linky.evoluServers.v1";
const LEGACY_DEFAULTS_REMOVED_KEY = "linky.evoluServers.defaultRemoved.v1";
const LEGACY_DEFAULT_RELAY_URLS = [
  "wss://evolu.linky.fit",
  "wss://free.evoluhq.com",
];

const DISABLED_RELAYS_KEY = "linky.evoluServers.disabled.v1";

const UrlList = Schema.Array(Schema.String);

type Stringifiable =
  | string
  | number
  | boolean
  | bigint
  | symbol
  | { toString(): string }
  | null
  | undefined;

/**
 * The relay's stable identity: a `ws:` or `wss:` URL without search, hash or
 * trailing slashes, or `null` for anything else.
 */
export const normalizeEvoluRelayUrl = (value: Stringifiable): string | null => {
  const raw = String(value ?? "")
    .trim()
    .replace(/\/+$/, "");
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "wss:" && u.protocol !== "ws:") return null;
    const pathname = u.pathname.replace(/\/+$/, "");
    // Preserve pathname (some relays may be hosted under a path), but drop
    // search/hash for stable identity.
    return `${u.origin}${pathname === "/" ? "" : pathname}`.replace(/\/+$/, "");
  } catch {
    return null;
  }
};

const normalizeUrlList = (
  urls: ReadonlyArray<Stringifiable>,
): ReadonlyArray<string> => {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const url of urls.map(normalizeEvoluRelayUrl)) {
    if (!url) continue;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(url);
  }
  return unique;
};

export interface EvoluRelaySettings {
  /** The recommended relays followed by the user's, deduplicated. */
  readonly configuredUrls: () => ReadonlyArray<string>;
  readonly disabledUrls: () => ReadonlyArray<string>;
  /** The configured relays minus the disabled ones: what the transports use. */
  readonly activeUrls: () => ReadonlyArray<string>;
  readonly isRecommended: (url: string) => boolean;
  /** Saves the user's relays; recommended ones are dropped, as they are always configured. */
  readonly setUrls: (urls: ReadonlyArray<string>) => void;
  readonly setDisabled: (url: string, disabled: boolean) => void;
}

/**
 * The device-local Evolu relay list. Creating it migrates the storage of
 * versions before recommended relays once: an existing device keeps the
 * relays it had that are not recommended now, the old defaults included
 * unless the user removed them. The recommendation is read once, so a
 * refreshed one applies to the next settings made.
 */
export const makeEvoluRelaySettings = (
  kv: KeyValueStorage,
  {
    envDefaults,
    recommended,
    hasStoredAccount,
    onEvent,
  }: {
    /** Relays the build pins for a fresh origin; when set they replace both the recommendation and the old defaults. */
    readonly envDefaults: ReadonlyArray<string>;
    readonly recommended: ReadonlyArray<string>;
    /** Whether the device already holds an account, which makes it an existing install for the migration. */
    readonly hasStoredAccount: boolean;
    readonly onEvent?: (event: LinkyEvoluEvent) => void;
  },
): EvoluRelaySettings => {
  const recommendedUrls = normalizeUrlList(
    envDefaults.length > 0 ? envDefaults : recommended,
  );

  const isRecommended = (url: string): boolean =>
    recommendedUrls.some(
      (candidate) => candidate.toLowerCase() === url.toLowerCase(),
    );

  const disabledUrls = (): ReadonlyArray<string> =>
    normalizeUrlList(readJson(kv, DISABLED_RELAYS_KEY, UrlList, []));

  const configuredUrls = (): ReadonlyArray<string> =>
    normalizeUrlList([
      ...recommendedUrls,
      ...readJson(kv, USER_RELAYS_KEY, UrlList, []),
    ]);

  const activeUrls = (): ReadonlyArray<string> => {
    const disabledLower = new Set(
      disabledUrls().map((url) => url.toLowerCase()),
    );
    return configuredUrls().filter(
      (url) => !disabledLower.has(url.toLowerCase()),
    );
  };

  const setUrls = (urls: ReadonlyArray<string>): void =>
    writeJson(
      kv,
      USER_RELAYS_KEY,
      normalizeUrlList(urls).filter((url) => !isRecommended(url)),
    );

  const setDisabled = (url: string, disabled: boolean): void => {
    const normalized = normalizeEvoluRelayUrl(url);
    if (!normalized) return;
    const current = disabledUrls();
    const lower = normalized.toLowerCase();
    writeJson(
      kv,
      DISABLED_RELAYS_KEY,
      disabled
        ? normalizeUrlList([...current, normalized])
        : normalizeUrlList(current.filter((u) => u.toLowerCase() !== lower)),
    );
  };

  // Older versions stored the full selection, or nothing while the built-in
  // defaults were untouched. A fresh install has neither a selection nor a seed.
  const migrateLegacyRelays = (): void => {
    if (kv.getItem(USER_RELAYS_KEY) !== null) return;
    const legacyServerUrls = readJson(kv, LEGACY_RELAYS_KEY, UrlList, []);
    const defaultsRemoved = readJson(
      kv,
      LEGACY_DEFAULTS_REMOVED_KEY,
      Schema.Boolean,
      false,
    );
    const isExistingInstall =
      kv.getItem(LEGACY_RELAYS_KEY) !== null || hasStoredAccount;
    const legacyDefaults =
      envDefaults.length > 0 ? envDefaults : LEGACY_DEFAULT_RELAY_URLS;
    setUrls(
      isExistingInstall && !defaultsRemoved
        ? [...legacyDefaults, ...legacyServerUrls]
        : legacyServerUrls,
    );
    onEvent?.({
      _tag: "UserRelaysMigrated",
      legacyServerUrls,
      defaultsRemoved,
      isExistingInstall,
    });
  };

  migrateLegacyRelays();

  return {
    configuredUrls,
    disabledUrls,
    activeUrls,
    isRecommended,
    setUrls,
    setDisabled,
  };
};
