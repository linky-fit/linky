import {
  IdentityProvider,
  MasterSecretProvider,
  parseSlip39Share,
} from "@linky-fit/identity";
import { Bip39Seed } from "@linky-fit/linkshu";
import type { NostrSecretKey, Pubkey } from "@linky-fit/linkstr";
import { Effect, Layer } from "effect";
import { ConfigError } from "./config";

export interface BotIdentity {
  readonly secretKey: NostrSecretKey;
  readonly pubkey: Pubkey;
  readonly cashuSeed: Bip39Seed;
}

/**
 * Derives Linky Bot's keys from its recovery seed the same way the app does.
 * Every failure becomes one fixed message, because a parse error quotes its input.
 */
export const deriveBotIdentity = (recoverySeed: string): Promise<BotIdentity> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const share = yield* parseSlip39Share(recoverySeed);
      const identity = yield* Effect.provide(
        IdentityProvider,
        IdentityProvider.Live.pipe(
          Layer.provide(MasterSecretProvider.fromSlip39Share(share)),
        ),
      );
      return {
        secretKey: identity.nostrSigningKey,
        pubkey: identity.nostrPublicKey,
        cashuSeed: Bip39Seed.make(identity.cashuWalletSeed),
      };
    }).pipe(
      Effect.catchAllCause(() =>
        Effect.fail(
          new ConfigError(
            "SUPPORTER_RECOVERY_SEED is not a valid SLIP-39 share",
          ),
        ),
      ),
    ),
  );
