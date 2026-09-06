import {
  deriveOwnerMnemonicsFromMasterSecret,
  IdentityProvider,
  MasterSecretProvider,
  parseSlip39Share,
  recoverMasterSecretFromSlip39Share,
  type Bip39Mnemonic12,
} from "@linky/identity";
import { Effect, Layer, Schema } from "effect";
import { getPublicKey, nip19 } from "nostr-tools";
import { decrypt, getConversationKey } from "nostr-tools/nip44";
import {
  safeLocalStorageGetJson,
  safeLocalStorageRemove,
  safeLocalStorageSet,
} from "./utils/storage";

export interface TrackerSession {
  pubkey: string;
  npub: string;
  ownerMnemonic: Bip39Mnemonic12;
  decrypt: (pubkey: string, ciphertext: string) => Promise<string>;
  dispose: () => void;
}

export const SESSION_SEED_KEY = "linky.errorTracker.seed";
const StoredSeed = Schema.String.pipe(
  Schema.filter(
    (input) => Effect.runSyncExit(parseSlip39Share(input))._tag === "Success",
  ),
);

const sessionFromKey = (
  key: Uint8Array,
  ownerMnemonic: Bip39Mnemonic12,
): TrackerSession => {
  const pubkey = getPublicKey(key);
  let disposed = false;
  return {
    pubkey,
    npub: nip19.npubEncode(pubkey),
    ownerMnemonic,
    decrypt: async (sender, ciphertext) => {
      if (disposed) throw new Error("Session is closed.");
      const conversationKey = getConversationKey(key, sender);
      try {
        return decrypt(ciphertext, conversationKey);
      } finally {
        conversationKey.fill(0);
      }
    },
    dispose: () => {
      disposed = true;
      key.fill(0);
    },
  };
};

export const loginWithSecret = async (
  input: string,
): Promise<TrackerSession> => {
  try {
    const share = await Effect.runPromise(parseSlip39Share(input));
    const masterSecret = await Effect.runPromise(
      recoverMasterSecretFromSlip39Share(share),
    );
    try {
      const [ownerMnemonic] = await Effect.runPromise(
        deriveOwnerMnemonicsFromMasterSecret(masterSecret, [
          { role: "errorTracker" },
        ]),
      );
      if (!ownerMnemonic) throw new Error("Owner derivation failed.");
      const identities = await Effect.runPromise(
        Effect.provide(
          IdentityProvider,
          Layer.provide(
            IdentityProvider.Live,
            Layer.succeed(MasterSecretProvider, masterSecret),
          ),
        ),
      );
      try {
        return sessionFromKey(
          Uint8Array.from(identities.nostrSigningKey),
          ownerMnemonic,
        );
      } finally {
        identities.nostrSigningKey.fill(0);
        identities.cashuWalletSeed.fill(0);
        identities.storageMetaOwnerKey.fill(0);
        identities.storageIdentityOwnerKey.fill(0);
      }
    } finally {
      masterSecret.fill(0);
    }
  } catch {
    throw new Error("Enter a valid Linky 20-word recovery phrase.");
  }
};

export const rememberSessionSeed = (input: string): void => {
  let normalized: string;
  try {
    normalized = Effect.runSync(parseSlip39Share(input));
  } catch {
    throw new Error("Enter a valid Linky 20-word recovery phrase.");
  }
  if (!safeLocalStorageSet(SESSION_SEED_KEY, JSON.stringify(normalized))) {
    throw new Error(
      "Could not save your login. Enable browser storage and try again.",
    );
  }
};

export const clearSavedSession = (): void => {
  if (!safeLocalStorageRemove(SESSION_SEED_KEY)) {
    throw new Error(
      "Could not remove your saved login. Enable browser storage and try again.",
    );
  }
};

export const restoreSavedSession = async (): Promise<TrackerSession | null> => {
  const seed = safeLocalStorageGetJson(
    SESSION_SEED_KEY,
    Schema.NullOr(StoredSeed),
    null,
  );
  if (seed === null) {
    safeLocalStorageRemove(SESSION_SEED_KEY);
    return null;
  }
  return loginWithSecret(seed);
};
