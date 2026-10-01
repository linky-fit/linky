import { Context, Layer } from "effect";
import type { Bip39Seed } from "../domain/primitives";

export interface CashuSeedService {
  readonly bip39Seed: Bip39Seed;
}

/**
 * The raw seed all deterministic operations derive from. Handing the package
 * seed bytes is the point: linkshu is the trust boundary the seed exists for,
 * so platforms pass the material in and never perform derivations themselves.
 */
export class CashuSeed extends Context.Service<CashuSeed, CashuSeedService>()(
  "linkshu/CashuSeed",
) {
  static fromBytes(bip39Seed: Bip39Seed): Layer.Layer<CashuSeed> {
    return Layer.succeed(CashuSeed, { bip39Seed });
  }
}
