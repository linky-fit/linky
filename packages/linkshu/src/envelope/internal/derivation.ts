import {
  Amount as CashuAmount,
  blindMessage,
  OutputData,
} from "@cashu/cashu-ts";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, concatBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import type { EnvelopeKey } from "../../domain/primitives";

// Envelope outputs derive from the seed and the caller's key alone, never
// from a counter, keyset or amount: every context holding the seed builds
// the same blinded messages for a key, so the mint signs them once.

/** Slots a restore probes; a binary split of any safe integer needs fewer. */
export const ENVELOPE_SLOTS = 64;

const DOMAIN = utf8ToBytes("linkshu/envelope/v1");
const SECP256K1_ORDER =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

interface EnvelopeSlot {
  /** Hex text, like NUT-13 secrets, so the proof secret is printable. */
  readonly secret: string;
  readonly blindingFactor: bigint;
}

const slotMessage = (label: string, slot: number): Uint8Array => {
  const index = new Uint8Array(4);
  new DataView(index.buffer).setUint32(0, slot);
  return concatBytes(utf8ToBytes(label), index);
};

const slotDeriver = (seed: Uint8Array, key: EnvelopeKey) => {
  const root = hmac(sha256, seed, concatBytes(DOMAIN, utf8ToBytes(key)));
  return (slot: number): EnvelopeSlot => ({
    secret: bytesToHex(hmac(sha256, root, slotMessage("secret", slot))),
    blindingFactor:
      BigInt(`0x${bytesToHex(hmac(sha256, root, slotMessage("r", slot)))}`) %
      SECP256K1_ORDER,
  });
};

const outputOf = (
  slot: EnvelopeSlot,
  amount: number,
  keysetId: string,
): OutputData => {
  const secret = utf8ToBytes(slot.secret);
  const { B_ } = blindMessage(secret, slot.blindingFactor);
  return new OutputData(
    { amount: CashuAmount.from(amount), B_: B_.toHex(true), id: keysetId },
    slot.blindingFactor,
    secret,
  );
};

/** Ascending powers of two summing to `amount`. */
const denominationsOf = (amount: number): ReadonlyArray<number> => {
  const denominations: number[] = [];
  let rest = amount;
  for (let denomination = 1; rest > 0; denomination *= 2) {
    if (rest % (denomination * 2) !== 0) {
      denominations.push(denomination);
      rest -= denomination;
    }
  }
  return denominations;
};

/** The outputs that fund an envelope of `amount`, one slot per denomination. */
export const envelopeOutputs = (
  seed: Uint8Array,
  key: EnvelopeKey,
  amount: number,
  keysetId: string,
): ReadonlyArray<OutputData> => {
  const slotAt = slotDeriver(seed, key);
  return denominationsOf(amount).map((denomination, slot) =>
    outputOf(slotAt(slot), denomination, keysetId),
  );
};

/** Every slot's output, amountless: what a NUT-09 restore asks about. */
export const envelopeProbeOutputs = (
  seed: Uint8Array,
  key: EnvelopeKey,
  keysetId: string,
): ReadonlyArray<OutputData> => {
  const slotAt = slotDeriver(seed, key);
  return Array.from({ length: ENVELOPE_SLOTS }, (_, slot) =>
    outputOf(slotAt(slot), 0, keysetId),
  );
};

/** The proof secret of slot 0, which every funded envelope uses. */
export const firstEnvelopeSecret = (
  seed: Uint8Array,
  key: EnvelopeKey,
): string => slotDeriver(seed, key)(0).secret;
