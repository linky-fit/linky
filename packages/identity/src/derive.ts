import { HDKey } from "@scure/bip32";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { Effect, Match, Schema } from "effect";
import { deriveBip85Entropy, deriveOwnerKeyAtPath } from "./bip85";
import {
  CASHU_SEED_PATH,
  cashuOwnerPath,
  contactsOwnerPath,
  IDENTITY_OWNER_PATH,
  messagesOwnerPath,
  META_OWNER_PATH,
  transactionsOwnerPath,
} from "./derivationPaths";
import {
  Bip39Mnemonic12,
  Bip39Mnemonic24,
  type MasterSecret,
  type OwnerKey,
  OwnerLaneIndex,
  type OwnerRole,
} from "./domain";
import { decodeUnknown, IdentityDerivationError } from "./slip39";

const ZERO_OWNER_LANE_INDEX = OwnerLaneIndex.make(0);

export interface OwnerMnemonicRequest {
  readonly index?: OwnerLaneIndex;
  readonly role: OwnerRole;
}

const deriveOwnerPath = (
  role: OwnerRole,
  index: OwnerLaneIndex = ZERO_OWNER_LANE_INDEX,
): string =>
  Match.value(role).pipe(
    Match.when("meta", () => META_OWNER_PATH),
    Match.when("identity", () => IDENTITY_OWNER_PATH),
    Match.when("contacts", () => contactsOwnerPath(index)),
    Match.when("cashu", () => cashuOwnerPath(index)),
    Match.when("transactions", () => transactionsOwnerPath(index)),
    Match.when("messages", () => messagesOwnerPath(index)),
    Match.exhaustive,
  );

const deriveOwnerKeyFromPath = (
  root: HDKey,
  path: string,
): Effect.Effect<OwnerKey, IdentityDerivationError> =>
  Effect.try({
    try: () => deriveOwnerKeyAtPath(root, path),
    catch: (cause) =>
      new IdentityDerivationError({
        cause,
        message: `Failed to derive owner key at path ${path}`,
      }),
  });

const deriveOwnerMnemonicFromPath = (
  root: HDKey,
  path: string,
): Effect.Effect<Bip39Mnemonic12, IdentityDerivationError> =>
  Effect.gen(function* () {
    const ownerKey = yield* deriveOwnerKeyFromPath(root, path);
    return yield* decodeUnknown(
      Bip39Mnemonic12,
      entropyToMnemonic(ownerKey, wordlist),
      `Failed to derive owner mnemonic at path ${path}`,
    );
  });

export const parseOwnerLaneIndex = (
  input: unknown,
): Effect.Effect<OwnerLaneIndex, IdentityDerivationError> =>
  decodeUnknown(
    OwnerLaneIndex,
    input,
    "Invalid owner lane index (expected non-negative integer)",
  );

export const deriveOwnerMnemonicsFromMasterSecret = (
  masterSecret: MasterSecret,
  requests: ReadonlyArray<OwnerMnemonicRequest>,
): Effect.Effect<ReadonlyArray<Bip39Mnemonic12>, IdentityDerivationError> =>
  Effect.sync(() => HDKey.fromMasterSeed(masterSecret)).pipe(
    Effect.flatMap((root) =>
      Effect.all(
        requests.map((request) =>
          deriveOwnerMnemonicFromPath(
            root,
            deriveOwnerPath(request.role, request.index),
          ),
        ),
      ),
    ),
  );

export const deriveCashuMnemonicFromMasterSecret = (
  masterSecret: MasterSecret,
): Effect.Effect<Bip39Mnemonic24, IdentityDerivationError> =>
  Effect.try({
    try: () => {
      const root = HDKey.fromMasterSeed(masterSecret);
      const entropy = deriveBip85Entropy(root, CASHU_SEED_PATH, 32);
      return Schema.decodeUnknownSync(Bip39Mnemonic24)(
        entropyToMnemonic(entropy, wordlist),
      );
    },
    catch: (cause) =>
      new IdentityDerivationError({
        cause,
        message: "Failed to derive Cashu mnemonic from master secret",
      }),
  });
