import {
  getP2PKExpectedWitnessPubkeys,
  getSecretKind,
  getTokenMetadata,
} from "@cashu/cashu-ts";
import { TokenLocked } from "../../domain/errors";
import { p2pkPubkeyOf } from "../../domain/p2pk";
import type { P2pkUnlockingKey } from "../../domain/p2pk";
import type { MintUrl, TokenText } from "../../domain/primitives";

/** Keys that can sign for a proof now; empty when its secret locks nothing. */
const signersOf = (secret: string): ReadonlyArray<string> => {
  try {
    return getSecretKind(secret) === "P2PK"
      ? getP2PKExpectedWitnessPubkeys(secret)
      : [];
  } catch {
    return [];
  }
};

// Schnorr signatures commit to the x coordinate only, so either parity signs.
const xOnly = (pubkey: string): string => pubkey.slice(-64).toLowerCase();

/**
 * Refuses a token with a P2PK-locked proof the given key cannot sign for,
 * before the receive writes or asks anything: the mint would reject the
 * swap and leave a failed receive behind. HTLC and other secret kinds pass.
 */
export const lockedAgainst = (
  mint: MintUrl,
  tokenText: TokenText,
  unlockingKey: P2pkUnlockingKey | null,
): TokenLocked | null => {
  let secrets: ReadonlyArray<string>;
  try {
    secrets = getTokenMetadata(tokenText).incompleteProofs.map(
      (proof) => proof.secret,
    );
  } catch {
    return null;
  }
  const own = unlockingKey === null ? null : xOnly(p2pkPubkeyOf(unlockingKey));
  const unsignable = secrets
    .map(signersOf)
    .filter(
      (signers) =>
        signers.length > 0 && !signers.some((signer) => xOnly(signer) === own),
    );
  if (unsignable.length === 0) return null;
  return new TokenLocked({ mint, pubkeys: [...new Set(unsignable.flat())] });
};
