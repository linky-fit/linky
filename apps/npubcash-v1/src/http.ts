import { Schema } from "effect";
import { nip19, nip98 } from "nostr-tools";
import { getClaim } from "./claim";
import type { ServiceConfig } from "./config";
import type { Database } from "./db";
import type { Minter } from "./minter";
import { describeError, failure, json } from "./responses";
import { decodeUsernameRequest, putUsername } from "./username";

export const MAX_REQUEST_BODY_BYTES = 16 * 1024;

const decodeMintRequest = Schema.decodeUnknownSync(
  Schema.Struct({ mintUrl: Schema.optional(Schema.String) }),
);

interface HttpDeps {
  config: ServiceConfig;
  db: Database;
  minter: Minter;
}

type Handler = (
  deps: HttpDeps,
  pubkey: string,
  request: Request,
) => Promise<Response>;

const routes: Record<string, Handler> = {
  "GET /api/v1/claim": ({ db, minter }, pubkey) => getClaim(db, minter, pubkey),
  "GET /api/v1/info": async ({ config, db }, pubkey) => {
    const user = await db.user(pubkey);
    return json(200, {
      username: user ? user.name : null,
      npub: nip19.npubEncode(pubkey),
      mintUrl: user ? user.mint_url : config.defaultMintUrl,
    });
  },
  "PUT /api/v1/info/mint": async ({ db }, pubkey, request) => {
    const body = await readBody(request, decodeMintRequest);
    if (!body?.mintUrl || !URL.canParse(body.mintUrl)) {
      return failure(400, "Invalid URL");
    }
    // Old apps refuse to change the default mint when this fails.
    await db.setMint(pubkey, new URL(body.mintUrl).toString());
    return new Response(null, {
      status: 204,
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  },
  "PUT /api/v1/info/username": async (deps, pubkey, request) => {
    const body = await readBody(request, decodeUsernameRequest);
    if (!body) return failure(400, "Missing parameters");
    return putUsername(deps, pubkey, body);
  },
};

async function readBody<T>(
  request: Request,
  decode: (body: unknown) => T,
): Promise<T | null> {
  try {
    return decode(await request.json());
  } catch {
    return null;
  }
}

/** NIP-98 against `X-Forwarded-Proto` + `Host` + path, as the fork checked it; the signed payload is not checked. */
async function authenticate(
  request: Request,
  path: string,
): Promise<string | Response> {
  const host = request.headers.get("host");
  if (!host) return failure(400, "Missing host header");
  const header = request.headers.get("authorization");
  if (!header) return failure(401, "Missing Authorization Header");
  const protocol =
    request.headers.get("x-forwarded-proto") ??
    new URL(request.url).protocol.slice(0, -1);
  try {
    const event = await nip98.unpackEventFromToken(header);
    await nip98.validateEvent(
      event,
      `${protocol}://${host}${path}`,
      request.method,
    );
    return event.pubkey;
  } catch {
    return failure(401, "Invalid Authorization Header");
  }
}

const preflight = (request: Request) =>
  new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,HEAD,PUT,PATCH,POST,DELETE",
      "Access-Control-Allow-Headers":
        request.headers.get("access-control-request-headers") ?? "",
      Vary: "Access-Control-Request-Headers",
    },
  });

export function createHttpHandler(deps: HttpDeps) {
  return async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    if (request.method === "OPTIONS") return preflight(request);
    if (request.method === "GET" && path === "/health") {
      await deps.db.sql`SELECT 1`;
      return json(200, { ok: true, commit: deps.config.buildCommitSha });
    }

    const handler = routes[`${request.method} ${path}`];
    if (!handler) return failure(404, "Not found");
    const pubkey = await authenticate(request, path);
    if (pubkey instanceof Response) return pubkey;
    try {
      return await handler(deps, pubkey, request);
    } catch (error) {
      console.error(
        `[npubcash-v1] ${request.method} ${path}: ${describeError(error)}`,
      );
      return failure(500, "Something went wrong...");
    }
  };
}
