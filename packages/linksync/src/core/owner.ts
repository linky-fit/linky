import type { AppOwner } from "@evolu/common";
import { createAppOwner, Mnemonic, mnemonicToOwnerSecret } from "@evolu/common";

/** The Evolu app owner a BIP-39 mnemonic names; null when the text is not a mnemonic. */
export const appOwnerFromMnemonic = (mnemonic: string): AppOwner | null => {
  const parsed = Mnemonic.fromUnknown(mnemonic);
  if (!parsed.ok) return null;
  return createAppOwner(mnemonicToOwnerSecret(parsed.value));
};
