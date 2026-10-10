import {
  createSlip39Share,
  deriveCashuMnemonicFromMasterSecret,
  deriveOwnerMnemonicsFromMasterSecret,
  IdentityProvider,
  MasterSecretProvider,
  parseOwnerLaneIndex,
  parseSlip39Share,
  recoverMasterSecretFromSlip39Share,
  type MasterSecret,
  type OwnerRole,
} from "@linky-fit/identity";
import { encodeNpub, encodeNsec } from "@linky-fit/linkstr";
import { Effect, Layer } from "effect";

interface DerivedNostrKeys {
  npub: string;
  nsec: string;
}

interface EvoluOwnerMnemonicRequest {
  readonly index?: number;
  readonly role: OwnerRole;
}

interface PendingOwnerMnemonicRequest {
  readonly index: number;
  readonly resolve: (mnemonic: string | null) => void;
  readonly role: OwnerRole;
}

const pendingOwnerMnemonicRequests = new Map<
  string,
  PendingOwnerMnemonicRequest[]
>();

// Recovery is deterministic PBKDF2 work and every derivation from one share
// needs it, so the last share's result is reused.
let lastRecovery: {
  readonly rawText: string;
  readonly masterSecret: Promise<MasterSecret>;
} | null = null;

const recoverMasterSecret = (rawText: string): Promise<MasterSecret> => {
  if (lastRecovery?.rawText !== rawText) {
    lastRecovery = {
      rawText,
      masterSecret: Effect.runPromise(
        parseSlip39Share(rawText).pipe(
          Effect.flatMap((share) => recoverMasterSecretFromSlip39Share(share)),
        ),
      ),
    };
  }
  return lastRecovery.masterSecret;
};

export const deriveNostrKeysFromSlip39 = async (
  rawText: string,
): Promise<DerivedNostrKeys | null> => {
  try {
    const masterSecret = await recoverMasterSecret(rawText);
    const identity = await Effect.runPromise(
      Effect.provide(
        IdentityProvider,
        Layer.provide(
          IdentityProvider.layer,
          Layer.succeed(MasterSecretProvider, masterSecret),
        ),
      ),
    );
    const nsec = encodeNsec(identity.nostrSigningKey);
    const npub = encodeNpub(identity.nostrPublicKey);
    return { npub, nsec };
  } catch {
    return null;
  }
};

export const createSlip39Seed = async (): Promise<string | null> => {
  try {
    return await Effect.runPromise(createSlip39Share());
  } catch {
    return null;
  }
};

export const deriveCashuBip85MnemonicFromSlip39 = async (
  rawText: string,
): Promise<string | null> => {
  try {
    const masterSecret = await recoverMasterSecret(rawText);
    return await Effect.runPromise(
      deriveCashuMnemonicFromMasterSecret(masterSecret),
    );
  } catch {
    return null;
  }
};

const deriveEvoluOwnerMnemonicsFromSlip39 = async (
  rawText: string,
  requests: ReadonlyArray<EvoluOwnerMnemonicRequest>,
): Promise<ReadonlyArray<string> | null> => {
  try {
    const [masterSecret, parsedRequests] = await Promise.all([
      recoverMasterSecret(rawText),
      Promise.all(
        requests.map(async (request) => ({
          index: await Effect.runPromise(
            parseOwnerLaneIndex(request.index ?? 0),
          ),
          role: request.role,
        })),
      ),
    ]);
    return await Effect.runPromise(
      deriveOwnerMnemonicsFromMasterSecret(masterSecret, parsedRequests),
    );
  } catch {
    return null;
  }
};

const flushOwnerMnemonicRequests = async (rawText: string): Promise<void> => {
  const pending = pendingOwnerMnemonicRequests.get(rawText);
  if (!pending) return;
  pendingOwnerMnemonicRequests.delete(rawText);

  const mnemonics = await deriveEvoluOwnerMnemonicsFromSlip39(
    rawText,
    pending.map(({ index, role }) => ({ index, role })),
  );
  pending.forEach((request, index) => {
    request.resolve(mnemonics?.[index] ?? null);
  });
};

export const deriveEvoluOwnerMnemonicFromSlip39 = (
  rawText: string,
  role: OwnerRole,
  index = 0,
): Promise<string | null> =>
  new Promise((resolve) => {
    const pending = pendingOwnerMnemonicRequests.get(rawText);
    const request = { index, resolve, role };
    if (pending) {
      pending.push(request);
      return;
    }

    pendingOwnerMnemonicRequests.set(rawText, [request]);
    globalThis.queueMicrotask(() => {
      void flushOwnerMnemonicRequests(rawText);
    });
  });
