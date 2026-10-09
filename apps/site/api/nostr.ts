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
import { decodeNpub } from "./_profilePage.js";
import { safeFetch } from "./_safeFetch.js";

const RELAY_LIST_TIMEOUT_MS = 2500;

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

const sendNpubName = async (res: ApiResponse, npub: string, pubkey: string) => {
  const relays = await fetchWriteRelays(pubkey).catch(() => []);
  setJsonProxyHeaders(res);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Cache-Control",
    relays.length > 0
      ? "public, s-maxage=3600, stale-while-revalidate=86400"
      : "public, s-maxage=60",
  );
  res.status(200).json({
    names: { [npub]: pubkey },
    relays: relays.length > 0 ? { [pubkey]: relays } : {},
  });
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const name = getFirstQueryValue(req.query?.name)?.toLowerCase();
  const pubkey = name?.startsWith("npub1") ? decodeNpub(name) : null;
  if (name && pubkey) {
    await sendNpubName(res, name, pubkey);
    return;
  }

  try {
    const targetUrl = new URL("/.well-known/nostr.json", getNpubcashBaseUrl());
    if (name) {
      targetUrl.searchParams.set("name", name);
    }

    sendPublicProxyResult(res, await safeFetch(targetUrl));
  } catch {
    sendProxyFailure(res);
  }
}
