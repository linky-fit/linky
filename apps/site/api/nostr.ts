import {
  getFirstQueryValue,
  getNpubcashBaseUrl,
  sendProxyFailure,
  sendPublicProxyResult,
  type ApiRequest,
  type ApiResponse,
} from "./_npubcash.js";
import { safeFetch } from "./_safeFetch.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    const targetUrl = new URL("/.well-known/nostr.json", getNpubcashBaseUrl());
    const name = getFirstQueryValue(req.query?.name);
    if (name) {
      targetUrl.searchParams.set("name", name);
    }

    sendPublicProxyResult(res, await safeFetch(targetUrl));
  } catch (error) {
    sendProxyFailure(res, error);
  }
}
