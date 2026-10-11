import type { SettingsRepository } from "@linky-fit/linksync";
import type { KeyValueStorage } from "@linky-fit/linksync/evolu";
import { Effect, Option } from "effect";
import { AsyncResult, Atom, type AtomRegistry } from "effect/reactivity";
import { reportAppLog } from "../../../devtools/inspector/appLog";
import { CASHU_ONBOARDING_SET_MAIN_MINT_STORAGE_KEY } from "../../../utils/constants";
import {
  CASHU_DEFAULT_MINT_OVERRIDE_STORAGE_KEY,
  effectiveDefaultMintUrl,
  formatMintHost,
  MAIN_MINT_URL,
  normalizeMintUrl,
} from "../../../utils/mint";
import { NO_WRITE, runWrite, type WriteOutcome } from "../../lib/storeWrite";
import { platformAtom } from "../platform";
import { allowTestMintsAtom } from "../session/settings";
import { appOwnerIdAtom, settingsRepositoryAtom } from "../session/store";
import { ownerStorageKey } from "./ownerStorage";

export interface DefaultMintChoice {
  /** Normalized; null until one is chosen or suggested. */
  readonly mint: string | null;
  /** Chosen by the user or onboarding, on any device; npub.cash's suggestion is not a choice. */
  readonly chosen: boolean;
}

// Bumped after every write of the device override, which lives outside any atom.
const overrideRevisionAtom = Atom.keepAlive(Atom.make(0));
const npubCashSuggestionAtom = Atom.keepAlive(Atom.make<string | null>(null));

const readOverride = (kv: KeyValueStorage, ownerId: string): string | null =>
  normalizeMintUrl(
    kv.getItem(
      ownerStorageKey(CASHU_DEFAULT_MINT_OVERRIDE_STORAGE_KEY, ownerId),
    ),
  ) || null;

/**
 * The stored default mint: this device's override (owner-scoped key-value
 * storage, which mirrors the synced `defaultMint` setting), else the mint
 * npub.cash suggests.
 */
export const defaultMintChoiceAtom = Atom.readable((get): DefaultMintChoice => {
  get(overrideRevisionAtom);
  const ownerId = Option.getOrNull(AsyncResult.value(get(appOwnerIdAtom)));
  const override =
    ownerId === null ? null : readOverride(get(platformAtom).kv, ownerId);
  return override === null
    ? { mint: get(npubCashSuggestionAtom), chosen: false }
    : { mint: override, chosen: true };
});

/** The mint new funds arrive at; a hidden test mint falls back to the production mint. */
export const defaultMintAtom = Atom.readable((get) =>
  effectiveDefaultMintUrl(
    get(defaultMintChoiceAtom).mint,
    get(allowTestMintsAtom),
  ),
);

export interface DefaultMintCommands {
  /** Stores the user's choice on this device and in the synced setting; moves no funds. */
  readonly setDefaultMint: (mint: string) => Promise<WriteOutcome>;
  /** Takes over a choice synced from another device. */
  readonly adoptSyncedDefaultMint: (synced: string | null) => void;
  /** npub.cash's mint, used only while nothing is chosen. */
  readonly suggestDefaultMint: (mint: string) => void;
  /** A new account's first launch chooses the production default mint once. */
  readonly seedOnboardingDefaultMint: () => Promise<WriteOutcome>;
}

export const makeDefaultMintCommands = ({
  kv,
  ownerId,
  registry,
  settings,
}: {
  readonly kv: KeyValueStorage;
  readonly ownerId: string;
  readonly registry: AtomRegistry.AtomRegistry;
  readonly settings: Pick<SettingsRepository, "get" | "set">;
}): DefaultMintCommands => {
  const overrideKey = ownerStorageKey(
    CASHU_DEFAULT_MINT_OVERRIDE_STORAGE_KEY,
    ownerId,
  );
  const writeOverride = (mint: string) => {
    kv.setItem(overrideKey, mint);
    registry.update(overrideRevisionAtom, (revision) => revision + 1);
  };

  const setDefaultMint: DefaultMintCommands["setDefaultMint"] = async (
    mint,
  ) => {
    const cleaned = normalizeMintUrl(mint);
    if (!cleaned) return NO_WRITE;
    writeOverride(cleaned);
    reportAppLog({
      tag: "settings.defaultMint",
      summary: `Default mint set to ${formatMintHost(cleaned)}`,
      payload: { mint: cleaned },
    });
    const synced = await Effect.runPromise(settings.get("defaultMint"));
    if (normalizeMintUrl(synced ?? "") === cleaned) return NO_WRITE;
    return runWrite(settings.set("defaultMint", cleaned));
  };

  return {
    setDefaultMint,
    adoptSyncedDefaultMint: (synced) => {
      const cleaned = normalizeMintUrl(synced ?? "");
      if (!cleaned || readOverride(kv, ownerId) === cleaned) return;
      writeOverride(cleaned);
    },
    suggestDefaultMint: (mint) =>
      registry.set(npubCashSuggestionAtom, normalizeMintUrl(mint) || null),
    seedOnboardingDefaultMint: () => {
      if (kv.getItem(CASHU_ONBOARDING_SET_MAIN_MINT_STORAGE_KEY) !== "1")
        return NO_WRITE;
      kv.removeItem(CASHU_ONBOARDING_SET_MAIN_MINT_STORAGE_KEY);
      return readOverride(kv, ownerId) === null
        ? setDefaultMint(MAIN_MINT_URL)
        : NO_WRITE;
    },
  };
};

/** The default mint writes for the session's app owner. */
export const defaultMintCommandsAtom = Atom.readable((get) =>
  AsyncResult.map(
    AsyncResult.all({
      ownerId: get(appOwnerIdAtom),
      settings: get(settingsRepositoryAtom),
    }),
    ({ ownerId, settings }) =>
      makeDefaultMintCommands({
        kv: get(platformAtom).kv,
        ownerId,
        registry: get.registry,
        settings,
      }),
  ),
);
