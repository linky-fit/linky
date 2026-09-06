import type { SafeFetchResult } from "./_safeFetch.js";

interface ApiRequest {
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

const isJsonObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

export const parseJsonObject = (
  value: string,
): Record<string, unknown> | null => {
  try {
    const parsed: unknown = JSON.parse(value);
    return isJsonObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
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
  res.setHeader("Cache-Control", "no-store");
  if (result.contentType) {
    res.setHeader("Content-Type", result.contentType);
  }
  res.status(result.status).send(result.text);
};

export const sendPublicProxyResult = (
  res: ApiResponse,
  result: SafeFetchResult,
): void => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  sendProxyResult(res, result);
};

export const sendProxyFailure = (res: ApiResponse, error: unknown): void => {
  res.status(502).json({
    error: "Proxy fetch failed",
    detail: String(error ?? "unknown"),
  });
};

export type { ApiRequest, ApiResponse };
