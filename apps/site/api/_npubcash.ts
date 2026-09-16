import { Schema } from "effect";
import type { SafeFetchResult } from "./_safeFetch.js";

interface ApiRequest {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
  headers?: Record<string, string | string[] | undefined>;
}

interface ApiResponse {
  status: (code: number) => {
    json: (body: Record<string, unknown>) => void;
    send: (body: string) => void;
  };
  setHeader: (name: string, value: string) => void;
}

const defaultNpubcashBaseUrl = "https://npub.linky.fit";

export const getFirstQueryValue = (
  value: string | string[] | undefined,
): string | null => {
  const first = Array.isArray(value) ? value[0] : value;
  const trimmed = first?.trim();
  return trimmed ? trimmed : null;
};

const JsonObject = Schema.parseJson(
  Schema.Record({ key: Schema.String, value: Schema.Unknown }),
);

export const parseJsonObject = (
  value: string,
): Record<string, unknown> | null => {
  const parsed = Schema.decodeUnknownOption(JsonObject)(value);
  return parsed._tag === "Some" ? parsed.value : null;
};

export const setJsonProxyHeaders = (res: ApiResponse): void => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
};

export const requireProxyGet = (req: ApiRequest, res: ApiResponse): boolean => {
  setJsonProxyHeaders(res);
  if (req.method === "GET") return true;
  res.setHeader("Allow", "GET");
  res.status(405).json({ error: "Method not allowed" });
  return false;
};

export const getNpubcashBaseUrl = (): URL => {
  const rawValue = (
    process.env.NPUBCASH_BASE_URL ?? defaultNpubcashBaseUrl
  ).trim();

  try {
    return new URL(rawValue);
  } catch {
    return new URL(defaultNpubcashBaseUrl);
  }
};

export const getPublicOrigin = (req: ApiRequest): string => {
  const hostHeader = getFirstQueryValue(req.headers?.host);
  const forwardedProto = getFirstQueryValue(req.headers?.["x-forwarded-proto"]);
  const protocol = forwardedProto ?? "https";
  const host = hostHeader ?? "linky.fit";
  return `${protocol}://${host}`;
};

export const sendProxyResult = (
  res: ApiResponse,
  result: SafeFetchResult,
): void => {
  setJsonProxyHeaders(res);
  const body = parseJsonObject(result.text);
  if (!body) {
    res.status(502).json({ error: "Upstream response is not a JSON object" });
    return;
  }
  res.status(result.status).send(JSON.stringify(body));
};

export const sendPublicProxyResult = (
  res: ApiResponse,
  result: SafeFetchResult,
): void => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  sendProxyResult(res, result);
};

export const sendProxyFailure = (res: ApiResponse): void => {
  res.status(502).json({ error: "Proxy fetch failed" });
};

export type { ApiRequest, ApiResponse };
