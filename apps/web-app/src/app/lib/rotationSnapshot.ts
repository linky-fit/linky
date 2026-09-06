import { Schema, Option } from "effect";
import { UnknownRecord } from "../../utils/schema";
// Cross-device propagation of independent, pointer-only owner-lane rotations.
// Each scope writes one synced `ownerMeta` row so adopters converge on the
// active index and its rotation boundary without copying historical rows.
// Legacy plain `"<scope>-N"` values still decode, with the fields they lack
// nulled rather than zeroed, so an adopter never mistakes them for a fresh
// baseline.

type RotationScope = "cashu" | "contacts" | "messages" | "transactions";

export interface RotationSnapshot {
  /** New owner lane index (e.g. 3 → owner derivation path uses `<scope>-3`). */
  index: number;
  /**
   * Local count baseline captured at rotation time. Pointer-only rotations
   * normally write zero. Null means a legacy `"<scope>-N"` value omitted it.
   */
  baseline: number | null;
  /**
   * Legacy wire-compatibility field for clients that coupled contacts and
   * cashu rotations. New clients keep the scopes independent.
   */
  cashuBaseline: number | null;
  /** Wall-clock timestamp the rotation completed. Null on legacy values. */
  rotatedAtMs: number | null;
}

const LEGACY_REGEX: Record<RotationScope, RegExp> = {
  cashu: /^cashu-(\d+)$/,
  contacts: /^contacts-(\d+)$/,
  messages: /^messages-(\d+)$/,
  transactions: /^transactions-(\d+)$/,
};

const sanitizeNonNegativeInt = (value: unknown): number | null => {
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value)) return null;
  const truncated = Math.trunc(value);
  if (truncated < 0) return null;
  return truncated;
};

const sanitizePositiveInt = (value: unknown): number | null => {
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value)) return null;
  const truncated = Math.trunc(value);
  if (truncated <= 0) return null;
  return truncated;
};

export const encodeRotationSnapshot = (snap: RotationSnapshot): string => {
  const payload: Record<string, number> = { index: snap.index };
  if (snap.baseline !== null) payload.baseline = snap.baseline;
  if (snap.cashuBaseline !== null) payload.cashuBaseline = snap.cashuBaseline;
  if (snap.rotatedAtMs !== null) payload.rotatedAtMs = snap.rotatedAtMs;
  return JSON.stringify(payload);
};

export const decodeRotationSnapshot = (
  value: unknown,
  scope: RotationScope,
): RotationSnapshot | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // New format: JSON object. Start-byte check keeps the parse off the hot
  // path for legacy values.
  if (trimmed.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return null;
    }
    const obj = Option.getOrNull(
      Schema.decodeUnknownOption(UnknownRecord)(parsed),
    );
    if (!obj) return null;
    const index = sanitizeNonNegativeInt(obj.index);
    if (index === null) return null;
    return {
      index,
      baseline: sanitizeNonNegativeInt(obj.baseline),
      cashuBaseline:
        scope === "contacts" ? sanitizeNonNegativeInt(obj.cashuBaseline) : null,
      rotatedAtMs: sanitizePositiveInt(obj.rotatedAtMs),
    };
  }

  // Legacy format: `"<scope>-<index>"`.
  const match = LEGACY_REGEX[scope].exec(trimmed);
  if (!match) return null;
  const index = sanitizeNonNegativeInt(Number(match[1]));
  if (index === null) return null;
  return {
    index,
    baseline: null,
    cashuBaseline: null,
    rotatedAtMs: null,
  };
};
