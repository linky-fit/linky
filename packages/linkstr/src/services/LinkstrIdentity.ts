import { Context, Layer } from "effect";
import { getPublicKey } from "nostr-tools";
import { NostrSecretKey, Pubkey } from "../domain/primitives";

export interface LinkstrIdentityService {
  readonly pubkey: Pubkey;
  readonly secretKey: NostrSecretKey;
}

export class LinkstrIdentity extends Context.Service<
  LinkstrIdentity,
  LinkstrIdentityService
>()("linkstr/LinkstrIdentity") {
  static fromSecretKey(
    secretKey: NostrSecretKey,
  ): Layer.Layer<LinkstrIdentity> {
    return Layer.sync(LinkstrIdentity, () => ({
      pubkey: Pubkey.make(getPublicKey(secretKey)),
      secretKey,
    }));
  }
}
