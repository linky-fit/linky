import {
  createSlip39Share,
  deriveCashuMnemonicFromMasterSecret,
  deriveOwnerMnemonicsFromMasterSecret,
  IdentityProvider,
  MasterSecretProvider,
  parseOwnerLaneIndex,
  parseSlip39Share,
  recoverMasterSecretFromSlip39Share,
  type OwnerRole,
} from "@linky/identity";
import { encodeNpub, encodeNsec } from "@linky/linkstr";
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

const parseShare = async (rawText: string) => {
  return Effect.runPromise(parseSlip39Share(rawText));
};

export const deriveNostrKeysFromSlip39 = async (
  rawText: string,
): Promise<DerivedNostrKeys | null> => {
  try {
    const share = await parseShare(rawText);
    const identityLayer = Layer.provideMerge(
      IdentityProvider.Live,
      MasterSecretProvider.fromSlip39Share(share),
    );
    const identity = await Effect.runPromise(
      Effect.provide(IdentityProvider, identityLayer),
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
    const share = await parseShare(rawText);
    const masterSecret = await Effect.runPromise(
      recoverMasterSecretFromSlip39Share(share),
    );
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
    const share = await parseShare(rawText);
    const [masterSecret, parsedRequests] = await Promise.all([
      Effect.runPromise(recoverMasterSecretFromSlip39Share(share)),
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
