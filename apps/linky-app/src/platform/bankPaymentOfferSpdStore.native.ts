import { localStorageKv } from "../utils/storage";
import { isRecord } from "../utils/unknown";

export interface StoredSpdRecord {
  offerId: string;
  value: unknown;
}

export interface SpdRecordsChange<A> {
  put: readonly { offerId: string }[];
  remove: readonly string[];
  result: A;
}

// expo-sqlite commits each localStorage write before returning.
const SPD_RECORDS_KEY = "linky.bank_payment_offer_spd";

const readStored = (): StoredSpdRecord[] => {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(localStorageKv.getItem(SPD_RECORDS_KEY) ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((value: unknown) =>
    isRecord(value) && typeof value.offerId === "string"
      ? [{ offerId: value.offerId, value }]
      : [],
  );
};

/** Reads every stored offer record and writes back what `change` returns. */
export const updateSpdRecords = async <A>(
  change: (stored: readonly StoredSpdRecord[]) => SpdRecordsChange<A>,
): Promise<A> => {
  const stored = readStored();
  const { put, remove, result } = change(stored);
  const replaced = new Set([...remove, ...put.map((record) => record.offerId)]);
  localStorageKv.setItem(
    SPD_RECORDS_KEY,
    JSON.stringify([
      ...stored
        .filter((record) => !replaced.has(record.offerId))
        .map((record) => record.value),
      ...put,
    ]),
  );
  return result;
};
