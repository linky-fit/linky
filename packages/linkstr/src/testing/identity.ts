import { generateSecretKey, getPublicKey } from "nostr-tools";
import { NostrSecretKey, Pubkey } from "../domain/primitives";
import type { LinkstrIdentityService } from "../services/LinkstrIdentity";

export const makeIdentity = (): LinkstrIdentityService => {
  const secretKey = NostrSecretKey.make(generateSecretKey());
  return { pubkey: Pubkey.make(getPublicKey(secretKey)), secretKey };
};
