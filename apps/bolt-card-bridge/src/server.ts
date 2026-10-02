import type { BridgeConfig } from "./config";
import { consoleDebugLog, silentLog } from "./debugLog";
import { createHttpHandler } from "./http";
import { InMemoryRateLimiter } from "./requestSecurity";
import { CardSessions, type CardSocket } from "./sessions";

// Card messages are a few hundred bytes; anything larger is not a card.
export const MAX_SOCKET_MESSAGE_BYTES = 16 * 1024;
const MAX_RAW_LOG_CHARS = 8_000;

interface SocketData {
  /** Numbers connections in raw lines; the sessions number them on their own. */
  readonly connection: number;
  card: CardSocket | null;
}

interface BridgeServerOptions {
  /** Where debug lines go; console.debug unless a test captures them. */
  write?: (line: string) => void;
}

const clip = (text: string): string =>
  text.length > MAX_RAW_LOG_CHARS
    ? `${text.slice(0, MAX_RAW_LOG_CHARS)}…(+${text.length - MAX_RAW_LOG_CHARS} chars)`
    : text;

export interface BridgeServer {
  readonly port: number;
  readonly sessions: CardSessions;
  stop(): Promise<void>;
}

/** Serves the bridge on `config.port` (0 picks a free port). */
export function startBridgeServer(
  config: BridgeConfig,
  options: BridgeServerOptions = {},
): BridgeServer {
  const log =
    config.debug === "off" ? silentLog : consoleDebugLog(options.write);
  // Verbatim traffic, k1 and invoices included: only for local debugging.
  const raw = config.debug === "raw" ? log : silentLog;
  let nextConnection = 0;
  const sessions = new CardSessions({
    authTimeoutMs: config.authTimeoutMs,
    maxSessionMs: config.maxSessionMs,
    sessionWaitMs: config.sessionWaitMs,
    maxWaitersPerCard: config.maxWaitersPerCard,
    maxWaiters: config.maxWaiters,
    log,
  });
  const rateLimiter = new InMemoryRateLimiter();
  const handle = createHttpHandler({ config, sessions, rateLimiter, log });

  const cleanupTimer = setInterval(() => {
    rateLimiter.prune(Date.now());
  }, 60 * 1000);

  const server = Bun.serve<SocketData>({
    port: config.port,
    maxRequestBodySize: MAX_SOCKET_MESSAGE_BYTES,
    fetch: async (request, bunServer) => {
      const peerIp = bunServer.requestIP(request)?.address;
      raw("http.in", {
        method: request.method,
        url: request.url,
        peer: peerIp,
        forwardedFor: request.headers.get("x-forwarded-for") ?? undefined,
        upgrade: request.headers.get("upgrade") ?? undefined,
        origin: request.headers.get("origin") ?? undefined,
        userAgent: request.headers.get("user-agent") ?? undefined,
      });
      const response = await handle(request, {
        peerIp,
        upgrade: () => {
          nextConnection += 1;
          return bunServer.upgrade(request, {
            data: { connection: nextConnection, card: null },
          });
        },
      });
      if (response === undefined) {
        raw("http.upgraded", { url: request.url, connection: nextConnection });
      } else {
        raw("http.out", {
          url: request.url,
          status: response.status,
          body: clip(await response.clone().text()),
        });
      }
      return response;
    },
    websocket: {
      maxPayloadLength: MAX_SOCKET_MESSAGE_BYTES,
      idleTimeout: 60,
      sendPings: true,
      open: (socket) => {
        const { connection } = socket.data;
        const card: CardSocket = {
          send: (text) => {
            raw("ws.out", { connection, frame: clip(text) });
            return socket.send(text);
          },
          close: (code, reason) => {
            raw("ws.closing", { connection, code, reason });
            socket.close(code, reason);
          },
        };
        socket.data.card = card;
        raw("ws.open", { connection });
        sessions.open(card);
      },
      message: (socket, message) => {
        const text =
          typeof message === "string" ? message : message.toString("utf8");
        raw("ws.in", { connection: socket.data.connection, frame: clip(text) });
        if (socket.data.card) sessions.message(socket.data.card, text);
      },
      close: (socket, code, reason) => {
        raw("ws.close", {
          connection: socket.data.connection,
          code,
          reason: reason || undefined,
        });
        if (socket.data.card) sessions.close(socket.data.card, code);
      },
    },
    error(error) {
      log("http.error", {
        message: error instanceof Error ? error.message : String(error),
      });
      return new Response(
        JSON.stringify({ status: "ERROR", reason: "Internal error" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    },
  });

  return {
    port: server.port ?? config.port,
    sessions,
    async stop() {
      clearInterval(cleanupTimer);
      await server.stop(true);
    },
  };
}
