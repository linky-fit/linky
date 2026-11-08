import {
  makeNip98AuthHeader,
  UnixSeconds,
  type NostrSecretKey,
} from "@linky-fit/linkstr";
import { Schema } from "effect";
import { JsonValue } from "../types/json";
import {
  NPUB_CASH_REQUEST_TIMEOUT_MS,
  NPUB_CASH_SERVER_BASE_URL,
} from "./npubCashServer";
import {
  getOwnLightningAddressFromUsername,
  normalizeOwnLightningUsername,
} from "./npubCashUsernameClaim";
import { nowSeconds } from "./time";
import { asNonEmptyString, asRecord } from "./validation";

interface NpubCashProfileInfo {
  mintUrl: string | null;
  ownedLightningAddresses: string[];
}

/** Reads `GET /api/v2/user/info`: `{ data: { user: { name?, mintUrl } } }`. */
export const parseNpubCashProfileInfo = (
  value: JsonValue,
): NpubCashProfileInfo => {
  const user = asRecord(asRecord(asRecord(value)?.data)?.user);
  const mintUrl = asNonEmptyString(user?.mintUrl) ?? null;
  const username =
    normalizeOwnLightningUsername(asNonEmptyString(user?.name) ?? "") || null;

  const ownedLightningAddresses = username
    ? [getOwnLightningAddressFromUsername(username)]
    : [];

  return {
    mintUrl,
    ownedLightningAddresses,
  };
};

/**
 * The bought linky.fit address of the identity `secretKey` signs for, read
 * from its npub.cash account; null when it has none. Rejects when the server
 * does not answer with its info.
 */
export const fetchOwnedLightningAddress = async (
  secretKey: NostrSecretKey,
): Promise<string | null> => {
  const url = `${NPUB_CASH_SERVER_BASE_URL}/api/v2/user/info`;
  const response = await fetch(url, {
    headers: {
      Authorization: makeNip98AuthHeader(
        { url, method: "GET" },
        secretKey,
        UnixSeconds.make(nowSeconds()),
      ),
    },
    signal: AbortSignal.timeout(NPUB_CASH_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`npub.cash info: HTTP ${response.status}`);
  const info = parseNpubCashProfileInfo(
    Schema.decodeUnknownSync(JsonValue)(await response.json()),
  );
  return info.ownedLightningAddresses[0] ?? null;
};
