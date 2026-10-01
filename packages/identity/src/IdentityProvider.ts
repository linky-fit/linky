import { derivePubkey, NostrSecretKey, type Pubkey } from "@linky-fit/linkstr";
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { Context, Effect, Layer, Schema } from "effect";
import { deriveBip85Entropy, deriveOwnerKeyAtPath } from "./bip85";
import {
  CASHU_SEED_PATH,
  cashuOwnerPath,
  contactsOwnerPath,
  IDENTITY_OWNER_PATH,
  messagesOwnerPath,
  META_OWNER_PATH,
  NOSTR_PATH,
  transactionsOwnerPath,
} from "./derivationPaths";
import { CashuSeed, OwnerKey, OwnerLaneIndex } from "./domain";
import { MasterSecretProvider } from "./MasterSecretProvider";

export class IdentityProviderError extends Schema.TaggedError<IdentityProviderError>()(
  "IdentityProviderError",
  { cause: Schema.optional(Schema.Unknown), message: Schema.String },
) {}

interface Identities {
  readonly nostrSigningKey: NostrSecretKey;
  readonly nostrPublicKey: Pubkey;

  readonly cashuWalletSeed: CashuSeed;

  readonly storageMetaOwnerKey: OwnerKey;
  readonly storageIdentityOwnerKey: OwnerKey;
  readonly storageContactsOwnerKey: (index: OwnerLaneIndex) => OwnerKey;
  readonly storageCashuOwnerKey: (index: OwnerLaneIndex) => OwnerKey;
  readonly storageMessagesOwnerKey: (index: OwnerLaneIndex) => OwnerKey;
  readonly storageTransactionsOwnerKey: (index: OwnerLaneIndex) => OwnerKey;
}

export class IdentityProvider extends Context.Service<
  IdentityProvider,
  Identities
>()("IdentityProvider", {
  make: Effect.gen(function* () {
    const masterSecret = yield* MasterSecretProvider;
    const root = HDKey.fromMasterSeed(masterSecret);

    const nostrNode = root.derive(NOSTR_PATH);
    if (!nostrNode.privateKey) {
      return yield* new IdentityProviderError({
        message: "Nostr key derivation failed",
      });
    }
    const nostrSigningKey = NostrSecretKey.make(nostrNode.privateKey);
    const nostrPublicKey = derivePubkey(nostrSigningKey);

    const cashuEntropy = deriveBip85Entropy(root, CASHU_SEED_PATH, 32);
    const cashuMnemonic = entropyToMnemonic(cashuEntropy, wordlist);
    const cashuWalletSeed = CashuSeed.make(mnemonicToSeedSync(cashuMnemonic));

    const storageMetaOwnerKey = deriveOwnerKeyAtPath(root, META_OWNER_PATH);
    const storageIdentityOwnerKey = deriveOwnerKeyAtPath(
      root,
      IDENTITY_OWNER_PATH,
    );

    return {
      nostrSigningKey,
      nostrPublicKey,
      cashuWalletSeed,
      storageMetaOwnerKey,
      storageIdentityOwnerKey,
      storageContactsOwnerKey: (index: OwnerLaneIndex) =>
        deriveOwnerKeyAtPath(root, contactsOwnerPath(index)),
      storageCashuOwnerKey: (index: OwnerLaneIndex) =>
        deriveOwnerKeyAtPath(root, cashuOwnerPath(index)),
      storageMessagesOwnerKey: (index: OwnerLaneIndex) =>
        deriveOwnerKeyAtPath(root, messagesOwnerPath(index)),
      storageTransactionsOwnerKey: (index: OwnerLaneIndex) =>
        deriveOwnerKeyAtPath(root, transactionsOwnerPath(index)),
    };
  }).pipe(
    Effect.catchDefect(
      (defect) =>
        new IdentityProviderError({
          cause: defect,
          message: `IdentityProvider initialization failed`,
        }),
    ),
  ),
}) {
  static readonly layer: Layer.Layer<
    IdentityProvider,
    IdentityProviderError,
    MasterSecretProvider
  > = Layer.effect(this, this.make);
}
