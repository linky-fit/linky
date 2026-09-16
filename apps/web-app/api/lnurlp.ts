import {
  getFirstQueryValue,
  requireProxyGet,
  sendProxyFailure,
  sendProxyResult,
  type ApiRequest,
  type ApiResponse,
} from "../../site/api/_npubcash.js";
import { isAllowedTarget, safeFetch } from "../../site/api/_safeFetch.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const origin = getFirstQueryValue(req.headers?.origin);
  res.setHeader("Vary", "Origin");
  if (origin === "https://localhost" || origin === "capacitor://localhost") {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  if (!requireProxyGet(req, res)) return;

  const raw = getFirstQueryValue(req.query?.url);
  let target: URL;
  try {
    if (!raw || raw.length > 2000) throw new Error("Invalid url");
    target = new URL(raw);
    if (!isAllowedTarget(target)) throw new Error("Invalid url");
  } catch {
    res.status(400).json({ error: "Invalid url" });
    return;
  }

  try {
    sendProxyResult(res, await safeFetch(target));
  } catch {
    sendProxyFailure(res);
  }
}
