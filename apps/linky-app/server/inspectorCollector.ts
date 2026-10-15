import fs from "node:fs/promises";
import type { ServerResponse } from "node:http";
import path from "node:path";
import { TLSSocket } from "node:tls";
import type { Connect, Plugin } from "vite";
import {
  INSPECTOR_CLEAR_PATH,
  INSPECTOR_EVENTS_PATH,
  INSPECTOR_REPORT_PATH,
  INSPECTOR_STREAM_PATH,
  isInspectorChannel,
  parseInspectorRow,
} from "../src/devtools/inspector/inspectorRows";
import type {
  CollectedInspectorRow,
  InspectorRow,
} from "../src/devtools/inspector/inspectorRows";
import {
  createInspectorStore,
  INSPECTOR_MAX_ROWS,
  INSPECTOR_QUERY_DEFAULT_LIMIT,
} from "../src/devtools/inspector/inspectorStore";
import type { InspectorQuery } from "../src/devtools/inspector/inspectorStore";

const MAX_BODY_BYTES = 10 * 1024 * 1024;
const HEARTBEAT_INTERVAL_MS = 25_000;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const parseNumber = (value: string | null, fallback: number): number => {
  if (value === null || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseLimit = (value: string | null): number => {
  const parsed = parseNumber(value, INSPECTOR_QUERY_DEFAULT_LIMIT);
  return Math.min(INSPECTOR_MAX_ROWS, Math.max(0, Math.floor(parsed)));
};

const parseQuery = (searchParams: URLSearchParams): InspectorQuery => {
  const query: InspectorQuery = {
    cursor: parseNumber(searchParams.get("cursor"), 0),
    limit: parseLimit(searchParams.get("limit")),
  };
  const channel = searchParams.get("channel");
  if (isInspectorChannel(channel)) query.channel = channel;
  const client = searchParams.get("client");
  if (client) query.client = client;
  return query;
};

const isSameOriginRequest = (req: Connect.IncomingMessage): boolean => {
  const site = req.headers["sec-fetch-site"];
  if (site !== undefined && site !== "same-origin" && site !== "none") {
    return false;
  }
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  const protocol = req.socket instanceof TLSSocket ? "https" : "http";
  return origin === `${protocol}://${req.headers.host}`;
};

const sendJson = (
  res: ServerResponse,
  statusCode: number,
  value: unknown,
): void => {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(value));
};

const readRequestBody = (
  req: Connect.IncomingMessage,
): Promise<string | null> => {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let byteLength = 0;
    let settled = false;

    req.on("data", (chunk: unknown) => {
      if (settled) return;
      if (!Buffer.isBuffer(chunk)) {
        settled = true;
        reject(new Error("Unexpected request body chunk"));
        return;
      }

      byteLength += chunk.byteLength;
      if (byteLength > MAX_BODY_BYTES) {
        settled = true;
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString("utf8"));
    });

    req.on("error", (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
};

const parseReportBody = (
  body: string,
): { client: string; rows: InspectorRow[] } | null => {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isRecord(value) || !Array.isArray(value.rows)) return null;
  const client = typeof value.client === "string" ? value.client : "unknown";
  const rows = value.rows
    .map((rowValue) => parseInspectorRow(rowValue))
    .filter((row): row is InspectorRow => row !== null);
  return { client, rows };
};

const formatSseFrame = (row: CollectedInspectorRow): string => {
  return `id: ${row.id}\ndata: ${JSON.stringify(row)}\n\n`;
};

export const inspectorCollector = (): Plugin => ({
  name: "inspector-collector",
  apply: "serve",
  async configureServer(server) {
    const inspectorDirectory = path.join(server.config.root, ".inspector");
    // Per-port filename so parallel dev servers (dev :5173, dev:prod :5175,
    // Playwright :5174) don't truncate and interleave each other's file.
    const port = server.config.server.port ?? 5173;
    const rowsFile = path.join(inspectorDirectory, `rows-${port}.ndjson`);
    const store = createInspectorStore();
    const sseClients = new Set<ServerResponse>();
    let fileQueue = Promise.resolve();

    await fs.mkdir(inspectorDirectory, { recursive: true, mode: 0o700 });
    await fs.chmod(inspectorDirectory, 0o700);
    await fs.writeFile(rowsFile, "", { encoding: "utf8", mode: 0o600 });
    await fs.chmod(rowsFile, 0o600);

    const queueFileOperation = (
      operation: () => Promise<void>,
    ): Promise<void> => {
      const result = fileQueue.then(operation);
      fileQueue = result.catch(() => undefined);
      return result;
    };

    const writeToSseClient = (client: ServerResponse, value: string): void => {
      if (client.destroyed || client.writableEnded) {
        sseClients.delete(client);
        return;
      }
      try {
        client.write(value);
      } catch {
        sseClients.delete(client);
        client.end();
      }
    };

    const broadcast = (row: CollectedInspectorRow): void => {
      const frame = formatSseFrame(row);
      for (const client of sseClients) writeToSseClient(client, frame);
    };

    const heartbeat = setInterval(() => {
      for (const client of sseClients) writeToSseClient(client, ":hb\n\n");
    }, HEARTBEAT_INTERVAL_MS);

    server.httpServer?.once("close", () => {
      clearInterval(heartbeat);
      for (const client of sseClients) client.end();
      sseClients.clear();
    });

    const middleware = async (
      req: Connect.IncomingMessage,
      res: ServerResponse,
      next: Connect.NextFunction,
    ): Promise<void> => {
      const requestUrl = req.url ?? "";
      if (!requestUrl.startsWith("/__inspector")) return next();

      res.removeHeader("Access-Control-Allow-Origin");
      if (!isSameOriginRequest(req)) {
        sendJson(res, 403, { error: "Inspector requests must be same-origin" });
        return;
      }
      const parsedUrl = new URL(requestUrl, "http://localhost");
      const requestPath = parsedUrl.pathname;

      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.end();
        return;
      }

      if (req.method === "POST" && requestPath === INSPECTOR_REPORT_PATH) {
        try {
          const body = await readRequestBody(req);
          if (body === null) {
            sendJson(res, 413, { error: "Request body is too large" });
            return;
          }

          const report = parseReportBody(body);
          if (!report) {
            sendJson(res, 400, { error: "Expected {client, rows} JSON" });
            return;
          }

          const appended = store.append(report.client, report.rows);
          if (appended.length > 0) {
            const ndjson = appended
              .map((row) => `${JSON.stringify(row)}\n`)
              .join("");
            await queueFileOperation(() =>
              fs.appendFile(rowsFile, ndjson, "utf8"),
            );
            for (const row of appended) broadcast(row);
          }

          res.statusCode = 204;
          res.end();
        } catch (error) {
          server.config.logger.error(
            `Inspector report failed: ${String(error)}`,
          );
          if (!res.headersSent) {
            sendJson(res, 500, { error: "Could not collect rows" });
          } else {
            res.end();
          }
        }
        return;
      }

      if (req.method === "GET" && requestPath === INSPECTOR_EVENTS_PATH) {
        sendJson(res, 200, store.query(parseQuery(parsedUrl.searchParams)));
        return;
      }

      if (req.method === "GET" && requestPath === INSPECTOR_STREAM_PATH) {
        const lastEventIdHeader = req.headers["last-event-id"];
        const lastEventId = Array.isArray(lastEventIdHeader)
          ? lastEventIdHeader[0]
          : lastEventIdHeader;
        const cursor =
          lastEventId === undefined
            ? parseNumber(parsedUrl.searchParams.get("cursor"), 0)
            : parseNumber(lastEventId, 0);

        res.statusCode = 200;
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.flushHeaders();
        for (const row of store.query({ cursor }).rows) {
          writeToSseClient(res, formatSseFrame(row));
        }
        sseClients.add(res);
        req.once("close", () => sseClients.delete(res));
        return;
      }

      if (req.method === "POST" && requestPath === INSPECTOR_CLEAR_PATH) {
        try {
          store.clear();
          await queueFileOperation(() => fs.writeFile(rowsFile, "", "utf8"));
          res.statusCode = 204;
          res.end();
        } catch (error) {
          server.config.logger.error(
            `Inspector clear failed: ${String(error)}`,
          );
          sendJson(res, 500, { error: "Could not clear rows" });
        }
        return;
      }

      res.statusCode = 404;
      res.end("Not found");
    };

    server.middlewares.use(middleware);
  },
});
