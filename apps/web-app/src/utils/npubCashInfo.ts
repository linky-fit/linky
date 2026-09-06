import type { JsonValue } from "../types/json";
import {
  getOwnLightningAddressFromUsername,
  normalizeOwnLightningUsername,
} from "./npubCashUsernameClaim";
import { asNonEmptyString, asRecord } from "./validation";

interface NpubCashProfileInfo {
  mintUrl: string | null;
  ownedLightningAddresses: string[];
}

export const parseNpubCashProfileInfo = (
  value: JsonValue,
): NpubCashProfileInfo => {
  const root = asRecord(value);
  const wrapped = asRecord(root?.data);

  const mintUrl =
    asNonEmptyString(root?.mintUrl) ??
    asNonEmptyString(wrapped?.mintUrl) ??
    asNonEmptyString(wrapped?.mintURL) ??
    null;

  const username =
    normalizeOwnLightningUsername(
      asNonEmptyString(root?.username) ??
        asNonEmptyString(wrapped?.username) ??
        "",
    ) || null;

  const ownedLightningAddresses = username
    ? [getOwnLightningAddressFromUsername(username)]
    : [];

  return {
    mintUrl,
    ownedLightningAddresses,
  };
};
