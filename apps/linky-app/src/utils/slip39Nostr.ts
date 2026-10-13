import {
  createSlip39Share,
  deriveCashuMnemonicFromMasterSecret,
  deriveNostrSecretKeyFromMasterSecret,
  deriveOwnerMnemonicsFromMasterSecret,
  parseOwnerLaneIndex,
  parseSlip39Share,
  recoverMasterSecretFromSlip39Share,
  type MasterSecret,
  type OwnerRole,
} from "@linky-fit/identity";
import { derivePubkey, encodeNpub, encodeNsec } from "@linky-fit/linkstr";
import { Effect } from "effect";

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

// Recovery and the Nostr key are deterministic and asked for several times
// per sign-in, so the last share's results are reused.
let lastRecovery: {
  readonly rawText: string;
  readonly masterSecret: Promise<MasterSecret>;
  nostrKeys?: Promise<DerivedNostrKeys>;
} | null = null;

const recoveryOf = (rawText: string) => {
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
  return lastRecovery;
};

const recoverMasterSecret = (rawText: string): Promise<MasterSecret> =>
  recoveryOf(rawText).masterSecret;

const nostrKeysOf = async (
  masterSecret: Promise<MasterSecret>,
): Promise<DerivedNostrKeys> => {
  const secretKey = await Effect.runPromise(
    deriveNostrSecretKeyFromMasterSecret(await masterSecret),
  );
  return {
    npub: encodeNpub(derivePubkey(secretKey)),
    nsec: encodeNsec(secretKey),
  };
};

export const forgetRecoveredMasterSecret = (): void => {
  lastRecovery = null;
};

export const deriveNostrKeysFromSlip39 = async (
  rawText: string,
): Promise<DerivedNostrKeys | null> => {
  const recovery = recoveryOf(rawText);
  recovery.nostrKeys ??= nostrKeysOf(recovery.masterSecret);
  try {
    return await recovery.nostrKeys;
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
