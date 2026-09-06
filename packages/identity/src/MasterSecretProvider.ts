import { Context, Layer } from "effect";
import type { MasterSecret, Slip39Passphrase, Slip39Share } from "./domain";
import {
  IdentityDerivationError,
  recoverMasterSecretFromSlip39Share,
} from "./slip39";

export class MasterSecretProvider extends Context.Tag("MasterSecretProvider")<
  MasterSecretProvider,
  MasterSecret
>() {
  static fromSlip39Share(
    share: Slip39Share,
    passphrase?: Slip39Passphrase,
  ): Layer.Layer<MasterSecretProvider, IdentityDerivationError> {
    return Layer.effect(
      MasterSecretProvider,
      recoverMasterSecretFromSlip39Share(share, passphrase),
    );
  }
}
