import type { IncomingMessage, ServerResponse } from "node:http";
import lnurlpHandler from "../api/lnurlp.js";
import { fetchLinkPreview } from "./linkPreview";

/** A connect middleware, as Vite and Metro dev servers both mount them. */
export type DevMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
) => void | Promise<void>;

export interface DevLogger {
  readonly warn: (message: string) => void;
  readonly error: (message: string) => void;
}

/** Dev counterpart of the /api/lnurlp Vercel function. */
export const lnurlpMiddleware: DevMiddleware = async (req, res, next) => {
  const url = new URL(req.url ?? "", "http://localhost");
  if (url.pathname !== "/api/lnurlp") return next();
  await lnurlpHandler(
    {
      method: req.method ?? "",
      headers: req.headers,
      query: Object.fromEntries(url.searchParams),
    },
    {
      setHeader: (name, value) => {
        res.setHeader(name, value);
      },
      status: (code) => {
        res.statusCode = code;
        return {
          json: (body) => {
            res.end(JSON.stringify(body));
          },
          send: (body) => {
            res.end(body);
          },
        };
      },
    },
  );
};

/** Dev counterpart of the /api/link-preview Vercel function. */
export const linkPreviewMiddleware =
  (logger: DevLogger): DevMiddleware =>
  async (req, res, next) => {
    const requestUrl = req.url ?? "";
    if (!requestUrl.startsWith("/api/link-preview")) return next();

    if (req.method !== "GET") {
      res.statusCode = 405;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    try {
      const parsed = new URL(requestUrl, "http://localhost");
      const target = String(parsed.searchParams.get("url") ?? "").trim();
      const preview = await fetchLinkPreview(target);
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify(preview));
    } catch (error) {
      logger.warn(`Link preview error: ${String(error ?? "unknown")}`);
      res.statusCode = 422;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Preview unavailable" }));
    }
  };
