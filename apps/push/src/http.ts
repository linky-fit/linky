import type { PushServiceConfig } from "./config";
import {
  isRecord,
  readNativeSubscribeRequest,
  readNativeUnsubscribeRequest,
  readProofAction,
  readPubkey,
  readSubscribeRequest,
  readUnsubscribeRequest,
  RequestError,
} from "./guards";
import { hashSecret } from "./hashSecret";
import { OwnershipVerifier } from "./ownership";
import { InMemoryRateLimiter, RateLimitError } from "./rateLimit";
import {
  PushStorage,
  StorageConflictError,
  StorageLimitError,
} from "./storage";
import type { OwnershipProofInput, ProofAction } from "./types";

interface HttpHandlerDependencies {
  config: PushServiceConfig;
  storage: PushStorage;
  ownershipVerifier: OwnershipVerifier;
  rateLimiter: InMemoryRateLimiter;
  pushDelivery: {
    nativeDeliveryEnabled: boolean;
  };
}

interface OwnershipRequest {
  proofs: OwnershipProofInput[];
  recipientPubkeys: string[];
}

// Without a request (Bun.serve's error hook) the first configured origin is
// the best available answer.
function resolveAllowedOrigin(
  config: PushServiceConfig,
  request: Request | null,
): string | null {
  if (config.corsOrigins.includes("*")) {
    return "*";
  }

  if (request === null) {
    return config.corsOrigins[0] ?? null;
  }

  const origin = request.headers.get("origin");
  if (!origin) {
    return null;
  }

  return config.corsOrigins.includes(origin) ? origin : null;
}

function responseHeaders(
  config: PushServiceConfig,
  request: Request | null,
  contentType = "application/json; charset=utf-8",
): Record<string, string> {
  const allowedOrigin = resolveAllowedOrigin(config, request);
  return {
    ...(allowedOrigin ? { "Access-Control-Allow-Origin": allowedOrigin } : {}),
    ...(allowedOrigin && allowedOrigin !== "*" ? { Vary: "Origin" } : {}),
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Content-Type": contentType,
  };
}

function jsonResponse(
  config: PushServiceConfig,
  request: Request | null,
  status: number,
  body: Record<string, unknown>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(config, request),
  });
}

function ipFromRequest(
  request: Request,
  server: Bun.Server<undefined>,
): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const [first] = forwarded.split(",");
    if (first && first.trim().length > 0) {
      return first.trim();
    }
  }

  return server.requestIP(request)?.address ?? "unknown";
}

async function readJsonBody(
  request: Request,
): Promise<Record<string | number | symbol, unknown>> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    throw new RequestError(
      400,
      "invalid_json",
      "Request body must be valid JSON",
    );
  }

  if (!isRecord(json)) {
    throw new RequestError(400, "invalid_request", "Body must be an object");
  }

  return json;
}

async function readVerifiedOwnershipRequest<Body extends OwnershipRequest>(
  request: Request,
  readBody: (value: unknown) => Body,
  action: ProofAction,
  ownershipVerifier: OwnershipVerifier,
  nowMs: number,
): Promise<{ body: Body; consumedChallengeNonces: string[] }> {
  const body = readBody(await readJsonBody(request));
  return {
    body,
    consumedChallengeNonces: ownershipVerifier.verifyProofs(
      action,
      body.recipientPubkeys,
      body.proofs,
      nowMs,
    ),
  };
}

export function errorResponse(
  config: PushServiceConfig,
  request: Request | null,
  error: unknown,
): Response {
  if (error instanceof RequestError) {
    return jsonResponse(config, request, error.status, {
      error: error.code,
      message: error.message,
    });
  }

  if (
    error instanceof RateLimitError ||
    error instanceof StorageConflictError ||
    error instanceof StorageLimitError
  ) {
    return jsonResponse(config, request, error.status, {
      error: error.code,
      message: error.message,
    });
  }

  console.error("[push] unhandled request error", error);
  return jsonResponse(config, request, 500, {
    error: "internal_error",
    message: "Internal server error",
  });
}

export function createHttpHandler({
  config,
  storage,
  ownershipVerifier,
  rateLimiter,
  pushDelivery,
}: HttpHandlerDependencies) {
  return async (
    request: Request,
    server: Bun.Server<undefined>,
  ): Promise<Response> => {
    const url = new URL(request.url);
    const nowMs = Date.now();

    try {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: responseHeaders(config, request),
        });
      }

      if (request.method === "GET" && url.pathname === "/health") {
        return jsonResponse(config, request, 200, { ok: true });
      }

      if (request.method === "GET" && url.pathname === "/") {
        return new Response(`${config.buildCommitSha}\n`, {
          status: 200,
          headers: responseHeaders(
            config,
            request,
            "text/plain; charset=utf-8",
          ),
        });
      }

      if (request.method === "GET" && url.pathname === "/vapid-public-key") {
        return jsonResponse(config, request, 200, {
          vapidPublicKey: config.vapidPublicKey,
        });
      }

      const ip = ipFromRequest(request, server);

      if (request.method === "POST" && url.pathname === "/auth/challenge") {
        rateLimiter.check(
          `auth:${ip}`,
          config.authRateLimitMax,
          config.authRateLimitWindowMs,
          nowMs,
        );
        const body = await readJsonBody(request);
        const pubkey = readPubkey(body.pubkey);
        const action = readProofAction(body.action);
        const expiresAt = nowMs + config.challengeTtlMs;
        const challenge = storage.createChallenge(
          pubkey,
          action,
          expiresAt,
          nowMs,
        );
        console.info(
          `[push] challenge issued action=${action} pubkey=${pubkey} ip=${ip}`,
        );

        return jsonResponse(config, request, 200, {
          pubkey,
          action,
          challenge,
          expiresAt,
        });
      }

      if (request.method === "POST" && url.pathname === "/subscribe") {
        rateLimiter.check(
          `subscribe:${ip}`,
          config.subscribeRateLimitMax,
          config.subscribeRateLimitWindowMs,
          nowMs,
        );

        const { body, consumedChallengeNonces } =
          await readVerifiedOwnershipRequest(
            request,
            readSubscribeRequest,
            "subscribe",
            ownershipVerifier,
            nowMs,
          );

        storage.registerSubscription({
          cleanupLegacySubscriptions: body.cleanupLegacySubscriptions,
          installationId: body.installationId,
          subscription: body.subscription,
          recipientPubkeys: body.recipientPubkeys,
          consumedChallengeNonces,
          maxPubkeysPerSubscription: config.maxPubkeysPerSubscription,
          maxSubscriptionsPerPubkey: config.maxSubscriptionsPerPubkey,
          nowMs,
        });
        console.info(
          `[push] subscribe ok endpoint=${hashSecret(body.subscription.endpoint)} installation=${body.installationId ?? "none"} cleanupLegacy=${body.cleanupLegacySubscriptions} pubkeys=${body.recipientPubkeys.length} ip=${ip}`,
        );

        return jsonResponse(config, request, 200, {
          ok: true,
          endpoint: body.subscription.endpoint,
          recipientPubkeys: body.recipientPubkeys,
        });
      }

      if (request.method === "POST" && url.pathname === "/native/subscribe") {
        rateLimiter.check(
          `subscribe:${ip}`,
          config.subscribeRateLimitMax,
          config.subscribeRateLimitWindowMs,
          nowMs,
        );

        if (!pushDelivery.nativeDeliveryEnabled) {
          return jsonResponse(config, request, 503, {
            error: "native_push_unavailable",
            message: "Native push delivery is not configured on the server",
          });
        }

        const { body, consumedChallengeNonces } =
          await readVerifiedOwnershipRequest(
            request,
            readNativeSubscribeRequest,
            "subscribe",
            ownershipVerifier,
            nowMs,
          );

        storage.registerNativeSubscription({
          cleanupLegacySubscriptions: body.cleanupLegacySubscriptions,
          installationId: body.installationId,
          device: body.device,
          recipientPubkeys: body.recipientPubkeys,
          consumedChallengeNonces,
          maxPubkeysPerSubscription: config.maxPubkeysPerSubscription,
          maxSubscriptionsPerPubkey: config.maxSubscriptionsPerPubkey,
          nowMs,
        });
        console.info(
          `[push] native subscribe ok token=${hashSecret(body.device.token)} installation=${body.installationId ?? "none"} platform=${body.device.platform} cleanupLegacy=${body.cleanupLegacySubscriptions} pubkeys=${body.recipientPubkeys.length} ip=${ip}`,
        );

        return jsonResponse(config, request, 200, {
          ok: true,
          platform: body.device.platform,
          recipientPubkeys: body.recipientPubkeys,
          token: body.device.token,
        });
      }

      if (request.method === "POST" && url.pathname === "/unsubscribe") {
        rateLimiter.check(
          `unsubscribe:${ip}`,
          config.unsubscribeRateLimitMax,
          config.unsubscribeRateLimitWindowMs,
          nowMs,
        );

        const { body, consumedChallengeNonces } =
          await readVerifiedOwnershipRequest(
            request,
            readUnsubscribeRequest,
            "unsubscribe",
            ownershipVerifier,
            nowMs,
          );

        const result = storage.unregisterSubscriptionPubkeys({
          endpoint: body.endpoint,
          recipientPubkeys: body.recipientPubkeys,
          consumedChallengeNonces,
          nowMs,
        });
        console.info(
          `[push] unsubscribe pubkeys endpoint=${hashSecret(body.endpoint)} removedPubkeys=${result.removedPubkeys} removedSubscription=${result.removedSubscription} ip=${ip}`,
        );

        return jsonResponse(config, request, 200, {
          ok: true,
          endpoint: body.endpoint,
          removedPubkeys: result.removedPubkeys,
          removedSubscription: result.removedSubscription,
        });
      }

      if (request.method === "POST" && url.pathname === "/native/unsubscribe") {
        rateLimiter.check(
          `unsubscribe:${ip}`,
          config.unsubscribeRateLimitMax,
          config.unsubscribeRateLimitWindowMs,
          nowMs,
        );

        const { body, consumedChallengeNonces } =
          await readVerifiedOwnershipRequest(
            request,
            readNativeUnsubscribeRequest,
            "unsubscribe",
            ownershipVerifier,
            nowMs,
          );

        const result = storage.unregisterNativeSubscriptionPubkeys({
          token: body.token,
          recipientPubkeys: body.recipientPubkeys,
          consumedChallengeNonces,
          nowMs,
        });
        console.info(
          `[push] native unsubscribe pubkeys token=${hashSecret(body.token)} removedPubkeys=${result.removedPubkeys} removedSubscription=${result.removedSubscription} ip=${ip}`,
        );

        return jsonResponse(config, request, 200, {
          ok: true,
          removedPubkeys: result.removedPubkeys,
          removedSubscription: result.removedSubscription,
          token: body.token,
        });
      }

      return jsonResponse(config, request, 404, {
        error: "not_found",
        message: "Route not found",
      });
    } catch (error) {
      return errorResponse(config, request, error);
    }
  };
}
