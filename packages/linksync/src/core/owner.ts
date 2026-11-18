import type { AppOwner, OwnerSecret, ShardOwner } from "@evolu/common";
import {
  createAppOwner,
  createShardOwner,
  Mnemonic,
  mnemonicToOwnerSecret,
} from "@evolu/common";

const mnemonicSecret = (mnemonic: string): OwnerSecret | null => {
  // Evolu's Mnemonic takes only lowercase words split by single spaces.
  const parsed = Mnemonic.fromUnknown(
    mnemonic.normalize("NFKD").trim().toLowerCase().split(/\s+/u).join(" "),
  );
  return parsed.ok ? mnemonicToOwnerSecret(parsed.value) : null;
};

/** The Evolu app owner a BIP-39 mnemonic names; null when the text is not a mnemonic. */
export const appOwnerFromMnemonic = (mnemonic: string): AppOwner | null => {
  const secret = mnemonicSecret(mnemonic);
  return secret === null ? null : createAppOwner(secret);
};

/**
 * The owner a mnemonic names, typed as one this database syncs beside its app
 * owner, as Evolu 7's lanes were; Evolu refuses another app owner.
 */
export const laneOwnerFromMnemonic = (mnemonic: string): ShardOwner | null => {
  const secret = mnemonicSecret(mnemonic);
  return secret === null ? null : createShardOwner(secret);
};
