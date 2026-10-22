import {
  deriveOwnerMnemonicsFromMasterSecret,
  IdentityProvider,
  looksLikeSlip39Share,
  MasterSecretProvider,
  parseOwnerLaneIndex,
  parseSlip39Share,
  recoverMasterSecretFromSlip39Share,
} from "@linky-fit/identity";
import { Bip39Seed } from "@linky-fit/linkshu";
import {
  decodeNsec,
  encodeNpub,
  encodeNsec,
  type NostrSecretKey,
  type Pubkey,
  derivePubkey,
} from "@linky-fit/linkstr";
import { appOwnerFromMnemonic } from "@linky-fit/linksync";
import type { KeyValueStorage } from "@linky-fit/linksync/evolu";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { Effect, Layer, Option, Schema } from "effect";

/**
 * Everything this device needs from the account's recovery seed, derived the
 * way Linky derives it, so the seed opens the same identity, wallet and synced
 * data as in Linky. Secrets: keep every field out of logs and HTTP.
 */
export interface Account {
  /** The SLIP-39 share the account restores from. */
  readonly recoverySeed: string;
  readonly secretKey: NostrSecretKey;
  readonly pubkey: Pubkey;
  readonly npub: string;
  /** The Evolu meta owner's mnemonic, which names and opens the synced database. */
  readonly appMnemonic: string;
  /** The cashu seed the wallet's proofs are generated from. */
  readonly cashuSeed: Bip39Seed;
}

const ACCOUNT_KEY = "linky.onchainOperator.account";

/** The account as this device stores it, so a start skips the slow PBKDF2 of SLIP-39. */
const StoredAccount = Schema.fromJsonString(
  Schema.Struct({
    recoverySeed: Schema.String,
    nsec: Schema.String,
    appMnemonic: Schema.String,
    cashuSeedHex: Schema.String,
  }),
);

export class InvalidRecoverySeed extends Schema.TaggedError<InvalidRecoverySeed>()(
  "InvalidRecoverySeed",
  {},
) {}

const META_OWNER = { role: "meta" as const };

/** Derives the account from a recovery seed; fails when the text is not a valid SLIP-39 share. */
export const deriveAccount = (
  recoverySeed: string,
): Effect.Effect<Account, InvalidRecoverySeed> =>
  Effect.gen(function* () {
    const share = yield* parseSlip39Share(recoverySeed);
    const masterSecret = yield* recoverMasterSecretFromSlip39Share(share);
    const identity = yield* Effect.provide(
      IdentityProvider,
      IdentityProvider.layer.pipe(
        Layer.provide(Layer.succeed(MasterSecretProvider, masterSecret)),
      ),
    );
    const index = yield* parseOwnerLaneIndex(0);
    const [appMnemonic] = yield* deriveOwnerMnemonicsFromMasterSecret(
      masterSecret,
      [{ ...META_OWNER, index }],
    );
    if (appMnemonic === undefined || appOwnerFromMnemonic(appMnemonic) === null)
      return yield* new InvalidRecoverySeed();
    return {
      recoverySeed: share,
      secretKey: identity.nostrSigningKey,
      pubkey: identity.nostrPublicKey,
      npub: encodeNpub(identity.nostrPublicKey),
      appMnemonic,
      cashuSeed: Bip39Seed.make(identity.cashuWalletSeed),
    };
  }).pipe(
    Effect.catchTags({
      IdentityDerivationError: () => Effect.fail(new InvalidRecoverySeed()),
      IdentityProviderError: () => Effect.fail(new InvalidRecoverySeed()),
    }),
  );

/** Whether text has the shape of a recovery seed, e.g. to enable a restore button. */
export const looksLikeRecoverySeed = looksLikeSlip39Share;

export const loadStoredAccount = (kv: KeyValueStorage): Account | null => {
  const stored = Schema.decodeUnknownOption(StoredAccount)(
    kv.getItem(ACCOUNT_KEY),
  );
  if (Option.isNone(stored)) return null;
  const { recoverySeed, nsec, appMnemonic, cashuSeedHex } = stored.value;
  const secretKey = decodeNsec(nsec);
  const cashuSeed = Schema.decodeUnknownOption(Bip39Seed)(
    hexToBytes(cashuSeedHex),
  );
  if (secretKey === null || Option.isNone(cashuSeed)) return null;
  const pubkey = derivePubkey(secretKey);
  return {
    recoverySeed,
    secretKey,
    pubkey,
    npub: encodeNpub(pubkey),
    appMnemonic,
    cashuSeed: cashuSeed.value,
  };
};

export const storeAccount = (kv: KeyValueStorage, account: Account): void =>
  kv.setItem(
    ACCOUNT_KEY,
    Schema.encodeSync(StoredAccount)({
      recoverySeed: account.recoverySeed,
      nsec: encodeNsec(account.secretKey),
      appMnemonic: account.appMnemonic,
      cashuSeedHex: bytesToHex(account.cashuSeed),
    }),
  );
