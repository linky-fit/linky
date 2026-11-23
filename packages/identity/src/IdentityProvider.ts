import { derivePubkey, NostrSecretKey, type Pubkey } from "@linky-fit/linkstr";
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { Context, Effect, Layer, Schema } from "effect";
import { deriveBip85Entropy } from "./bip85";
import { bip39MnemonicToSeed } from "./bip39Seed";
import { CASHU_SEED_PATH, NOSTR_PATH } from "./derivationPaths";
import { CashuSeed } from "./domain";
import { MasterSecretProvider } from "./MasterSecretProvider";

export class IdentityProviderError extends Schema.TaggedError<IdentityProviderError>()(
  "IdentityProviderError",
  { cause: Schema.optional(Schema.Unknown), message: Schema.String },
) {}

interface Identities {
  readonly nostrSigningKey: NostrSecretKey;
  readonly nostrPublicKey: Pubkey;
  /** Lazily derived and cached so callers that only need Nostr keys skip PBKDF2. */
  readonly cashuWalletSeed: Effect.Effect<CashuSeed, IdentityProviderError>;
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

    const cashuWalletSeed = yield* Effect.cached(
      Effect.try({
        try: () =>
          entropyToMnemonic(
            deriveBip85Entropy(root, CASHU_SEED_PATH, 32),
            wordlist,
          ),
        catch: (cause) =>
          new IdentityProviderError({
            cause,
            message: "Cashu wallet seed derivation failed",
          }),
      }).pipe(
        Effect.flatMap((cashuMnemonic) =>
          bip39MnemonicToSeed(cashuMnemonic).pipe(
            Effect.map(CashuSeed.make),
            Effect.mapError(
              (cause) =>
                new IdentityProviderError({
                  cause,
                  message: "Cashu wallet seed derivation failed",
                }),
            ),
          ),
        ),
      ),
    );

    return {
      nostrSigningKey,
      nostrPublicKey,
      cashuWalletSeed,
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
