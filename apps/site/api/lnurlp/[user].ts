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

const rewriteLnurlCallback = (
  payRequestText: string,
  publicOrigin: string,
  user: string,
): string => {
  const payload = parseJsonObject(payRequestText);
  if (!payload) return payRequestText;
  return JSON.stringify({
    ...payload,
    callback: `${publicOrigin}/.well-known/lnurlp/${encodeURIComponent(user)}`,
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
        ? rewriteLnurlCallback(proxyResult.text, getPublicOrigin(req), user)
        : proxyResult.text,
    });
  } catch (error) {
    sendProxyFailure(res, error);
  }
}
