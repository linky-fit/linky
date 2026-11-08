import { Option, Schema } from "effect";
import {
  getFirstQueryValue,
  getNpubcashBaseUrl,
  getPublicOrigin,
  parseJsonObject,
  sendProxyFailure,
  sendPublicProxyResult,
  type ApiRequest,
  type ApiResponse,
} from "../_npubcash.js";
import { safeFetch } from "../_safeFetch.js";

const LnurlMetadata = Schema.fromJsonString(
  Schema.Array(Schema.Tuple([Schema.String, Schema.String])),
);

const rewriteIdentifier = (metadata: unknown, identifier: string): unknown => {
  const entries = Option.getOrNull(
    Schema.decodeUnknownOption(LnurlMetadata)(metadata),
  );
  if (!entries?.some(([type]) => type === "text/identifier")) return metadata;
  return JSON.stringify(
    entries.map(([type, value]) => [
      type,
      type === "text/identifier" ? identifier : value,
    ]),
  );
};

const rewritePayRequest = (
  payRequestText: string,
  publicOrigin: string,
  user: string,
): string => {
  const payload = parseJsonObject(payRequestText);
  if (!payload) return payRequestText;
  return JSON.stringify({
    ...payload,
    callback: `${publicOrigin}/.well-known/lnurlp/${encodeURIComponent(user)}`,
    metadata: rewriteIdentifier(
      payload.metadata,
      `${user.toLowerCase()}@${new URL(publicOrigin).host}`,
    ),
  });
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    const user = getFirstQueryValue(req.query?.user);
    if (!user) {
      res.status(400).json({ error: "Missing user" });
      return;
    }

    const targetUrl = new URL(
      `/.well-known/lnurlp/${encodeURIComponent(user)}`,
      getNpubcashBaseUrl(),
    );

    const amount = getFirstQueryValue(req.query?.amount);
    const nostr = getFirstQueryValue(req.query?.nostr);
    if (amount) {
      targetUrl.searchParams.set("amount", amount);
    }
    if (nostr) {
      targetUrl.searchParams.set("nostr", nostr);
    }

    const proxyResult = await safeFetch(targetUrl);
    const isPayRequest = !amount;
    sendPublicProxyResult(res, {
      ...proxyResult,
      text: isPayRequest
        ? rewritePayRequest(proxyResult.text, getPublicOrigin(req), user)
        : proxyResult.text,
    });
  } catch {
    sendProxyFailure(res);
  }
}
