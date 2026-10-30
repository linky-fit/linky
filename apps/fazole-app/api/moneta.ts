/**
 * Relays the app's calls to MONETA's business API, which answers no browser
 * directly (no CORS): GET only, the two account-information paths the app
 * reads, the merchant's token passed through in the header as it came and
 * never logged. `vercel.json` rewrites `/api/moneta/<path>` here; the dev
 * server proxies the same prefix itself (vite.config.ts).
 */

const UPSTREAM = "https://api.moneta.cz/api/v4/vip/aisp/my/";
const PATH = /^accounts(?:\/[A-Za-z0-9._~-]{1,100}\/transactions)?$/u;
const QUERY_KEYS = ["fromDate", "toDate", "page", "size", "currency"] as const;
const QUERY_VALUE = /^[A-Za-z0-9:+.-]{1,40}$/u;
const TOKEN = /^Bearer \S{8,800}$/u;
const TIMEOUT_MS = 12_000;

interface RelayRequest {
  method?: string | undefined;
  query?: Record<string, string | string[] | undefined> | undefined;
  headers?: Record<string, string | string[] | undefined> | undefined;
}

interface RelayResponse {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => {
    json: (body: Record<string, unknown>) => void;
    send: (body: string) => void;
  };
}

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export const createMonetaRelay =
  (fetchFn: typeof fetch) =>
  async (req: RelayRequest, res: RelayResponse): Promise<void> => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== undefined && req.method !== "GET") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }
    const path = first(req.query?.path) ?? "";
    if (!PATH.test(path)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const authorization = first(req.headers?.authorization) ?? "";
    if (!TOKEN.test(authorization)) {
      res.status(401).json({ error: "Missing token" });
      return;
    }
    const url = new URL(path, UPSTREAM);
    for (const key of QUERY_KEYS) {
      const value = first(req.query?.[key]);
      if (value !== undefined && QUERY_VALUE.test(value)) {
        url.searchParams.set(key, value);
      }
    }
    let upstream: Response;
    let body: string;
    try {
      upstream = await fetchFn(url, {
        headers: { Authorization: authorization, Accept: "application/json" },
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      body = await upstream.text();
    } catch {
      res.status(502).json({ error: "Bank unreachable" });
      return;
    }
    res.setHeader(
      "Content-Type",
      upstream.headers.get("content-type") ?? "application/json",
    );
    res.status(upstream.status).send(body);
  };

export default createMonetaRelay(fetch);
