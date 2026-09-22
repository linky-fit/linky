import { appScope, shardScope, type RotationRule } from "../core";

/**
 * Rotation is byte-aware and count-aware, whichever fires first. The byte
 * threshold is a quarter of the official Evolu relay's 1 MB per-owner quota,
 * because the relay stores encrypted history with per-row overhead that the
 * local value bytes do not show. The mutation counts are the pre-package
 * thresholds, kept until real numbers say otherwise.
 */
export const SHARD_MAX_BYTES = 256 * 1024;
export const SHARD_ROTATION_COOLDOWN_MS = 60_000;

const rotation = (maxMutations: number): RotationRule => ({
  maxBytes: SHARD_MAX_BYTES,
  maxMutations,
  cooldownMs: SHARD_ROTATION_COOLDOWN_MS,
});

/** The scope table; `docs/concepts.md` is its prose twin and must match it. */
export const linkyScopes = {
  meta: appScope(["shardPointer", "setting"]),
  identity: shardScope({
    tables: ["nostrIdentity"],
    rotation: null,
    forget: "never",
  }),
  contacts: shardScope({
    tables: ["contact"],
    rotation: rotation(220),
    forget: "never",
  }),
  messages: shardScope({
    tables: ["conversation", "message", "reaction"],
    rotation: rotation(160),
    forget: { keepNewest: 4 },
  }),
  cashu: shardScope({
    tables: ["cashuProof", "cashuOperation"],
    rotation: rotation(170),
    forget: "never",
  }),
  transactions: shardScope({
    tables: ["transaction", "recurringPayment"],
    rotation: rotation(220),
    forget: { keepNewest: 4 },
  }),
};

export type LinkyScopes = typeof linkyScopes;
export type LinkyScope = keyof LinkyScopes;
