import { BoltCardId, type BridgeMessage } from "@linky-fit/bolt-card";
import { Either, Schema } from "effect";
import type { BridgeConfig } from "./config";
import {
  invoicePreview,
  shortCardId,
  silentLog,
  type DebugLog,
  type LogFields,
} from "./debugLog";
import { clientIp, type InMemoryRateLimiter } from "./requestSecurity";
import type { CardSessions } from "./sessions";

interface HttpDependencies {
  config: BridgeConfig;
  sessions: CardSessions;
  rateLimiter: InMemoryRateLimiter;
  log?: DebugLog;
}

/** What the handler needs from Bun's server for one request. */
export interface RequestContext {
  peerIp: string | undefined;
  /** Upgrades the request to a card session socket; false when it is not a WebSocket request. */
  upgrade: () => boolean;
}

// LUD-01 services answer cross-origin, so browser-based POS can call them.
const LNURL_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
};

const json = (status: number, body: Record<string, unknown>): Response =>
  new Response(JSON.stringify(body), { status, headers: LNURL_HEADERS });

const lnurlError = (reason: string, status = 200): Response =>
  json(status, { status: "ERROR", reason });

const decodeCardId = Schema.decodeUnknownEither(BoltCardId);
const HEX_32 = /^[0-9a-fA-F]{32}$/;
const HEX_16 = /^[0-9a-fA-F]{16}$/;
const HEX_64 = /^[0-9a-fA-F]{64}$/;
const MAX_INVOICE_LENGTH = 5_000;

export function createHttpHandler({
  config,
  sessions,
  rateLimiter,
  log = silentLog,
}: HttpDependencies) {
  const allowed = (key: string, maxHits: number, nowMs: number) =>
    rateLimiter.allow(key, maxHits, config.rateLimitWindowMs, nowMs);

  const forward = async (
    cardId: BoltCardId,
    build: (id: string) => BridgeMessage,
  ) => sessions.request(cardId, build, config.requestTimeoutMs);

  return async (
    request: Request,
    context: RequestContext,
  ): Promise<Response | undefined> => {
    const url = new URL(request.url);
    const nowMs = Date.now();
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: LNURL_HEADERS });
    }
    if (request.method !== "GET") return lnurlError("Method not allowed", 405);
    if (url.pathname === "/health") return json(200, { ok: true });
    if (url.pathname === "/") {
      return json(200, { ok: true, commit: config.buildCommitSha });
    }

    const ip = clientIp(
      context.peerIp,
      request.headers.get("x-forwarded-for"),
      config.trustedProxyIps,
    );
    if (!allowed(`ip:${ip}`, config.ipRateLimitMax, nowMs)) {
      log("pos.rateLimited", { scope: "ip", path: url.pathname.slice(0, 3) });
      return lnurlError("Too many requests", 429);
    }

    if (url.pathname === "/session") {
      return context.upgrade()
        ? undefined
        : lnurlError("Expected a WebSocket upgrade", 426);
    }

    const match = /^\/(w|cb)\/([^/]+)$/.exec(url.pathname);
    const cardId = match ? decodeCardId(match[2]) : null;
    if (!match || !cardId || Either.isLeft(cardId)) {
      log("pos.unknownCard", { path: url.pathname.slice(0, 3) });
      return lnurlError("Unknown card", 404);
    }
    const endpoint = match[1] === "w" ? "withdraw" : "callback";
    const fields: LogFields = { endpoint, card: shortCardId(cardId.right) };
    const respond = (
      response: Response,
      outcome: string,
      reason?: string,
    ): Response => {
      log("pos.response", {
        ...fields,
        status: response.status,
        outcome,
        reason,
        ms: Date.now() - nowMs,
      });
      return response;
    };
    const fail = (reason: string, status = 200) =>
      respond(lnurlError(reason, status), "ERROR", reason);

    if (!allowed(`card:${cardId.right}`, config.cardRateLimitMax, nowMs)) {
      return fail("Too many requests", 429);
    }

    if (endpoint === "withdraw") {
      const p = url.searchParams.get("p") ?? "";
      const c = url.searchParams.get("c") ?? "";
      log("pos.request", fields);
      if (!HEX_32.test(p) || !HEX_16.test(c)) {
        return fail("Invalid card data");
      }
      const answer = await forward(cardId.right, (id) => ({
        _tag: "withdraw",
        id,
        p,
        c,
      }));
      if (answer?._tag === "offer") {
        return respond(
          json(200, {
            tag: "withdrawRequest",
            callback: `${config.publicUrl}/cb/${cardId.right}`,
            k1: answer.k1,
            minWithdrawable: answer.minWithdrawable,
            maxWithdrawable: answer.maxWithdrawable,
            defaultDescription: answer.defaultDescription,
          }),
          "withdrawRequest",
        );
      }
      return fail(
        answer?._tag === "rejected" ? answer.reason : "Card is not active",
      );
    }

    const k1 = url.searchParams.get("k1") ?? "";
    const pr = url.searchParams.get("pr") ?? "";
    log("pos.request", { ...fields, pr: invoicePreview(pr) });
    if (!HEX_64.test(k1) || pr === "" || pr.length > MAX_INVOICE_LENGTH) {
      return fail("Invalid callback");
    }
    const answer = await forward(cardId.right, (id) => ({
      _tag: "callback",
      id,
      k1,
      pr,
    }));
    if (answer?._tag === "accepted") {
      return respond(json(200, { status: "OK" }), "OK");
    }
    return fail(
      answer?._tag === "rejected" ? answer.reason : "Card is not active",
    );
  };
}
