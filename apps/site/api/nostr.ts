import { Option, Schema } from "effect";
import { SimplePool } from "nostr-tools/pool";
import recommendedRelays from "../public/recommended-relays.json" with { type: "json" };
import {
  getFirstQueryValue,
  getNpubcashBaseUrl,
  sendProxyFailure,
  sendPublicProxyResult,
  setJsonProxyHeaders,
  type ApiRequest,
  type ApiResponse,
} from "./_npubcash.js";
import { safeFetch, type SafeFetchResult } from "./_safeFetch.js";

const RELAY_LIST_TIMEOUT_MS = 2500;

const NostrJson = Schema.parseJson(
  Schema.Struct({
    names: Schema.Record({ key: Schema.String, value: Schema.String }),
  }),
);

const isWssUrl = (value: string): boolean =>
  URL.canParse(value) && new URL(value).protocol === "wss:";

/** The write relays of the user's NIP-65 relay list, as found on Linky's default relays. */
const fetchWriteRelays = async (pubkey: string): Promise<string[]> => {
  const pool = new SimplePool();
  try {
    const relayList = await pool.get(
      recommendedRelays.nostr,
      { kinds: [10002], authors: [pubkey] },
      { maxWait: RELAY_LIST_TIMEOUT_MS },
    );
    return (relayList?.tags ?? []).flatMap(([tag, relay, marker]) =>
      tag === "r" && relay && marker !== "read" && isWssUrl(relay)
        ? [relay]
        : [],
    );
  } finally {
    pool.destroy();
  }
};

const resolvedPubkey = (
  result: SafeFetchResult,
  name: string,
): string | undefined =>
  result.status === 200
    ? Option.getOrUndefined(Schema.decodeUnknownOption(NostrJson)(result.text))
        ?.names[name]
    : undefined;

const sendNameWithRelays = async (
  res: ApiResponse,
  name: string,
  pubkey: string,
) => {
  const relays = await fetchWriteRelays(pubkey).catch(() => []);
  setJsonProxyHeaders(res);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Cache-Control",
    relays.length > 0
      ? "public, s-maxage=300, stale-while-revalidate=3600"
      : "public, s-maxage=60",
  );
  res.status(200).json({
    names: { [name]: pubkey },
    relays: relays.length > 0 ? { [pubkey]: relays } : {},
  });
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    const targetUrl = new URL("/.well-known/nostr.json", getNpubcashBaseUrl());
    const name = getFirstQueryValue(req.query?.name);
    if (name) {
      targetUrl.searchParams.set("name", name);
    }

    const result = await safeFetch(targetUrl);
    const pubkey = name ? resolvedPubkey(result, name) : undefined;
    if (name && pubkey) {
      await sendNameWithRelays(res, name, pubkey);
    } else {
      sendPublicProxyResult(res, result);
    }
  } catch {
    sendProxyFailure(res);
  }
}
