import {
  isCanonicalAuthTemplate,
  LINKAUTH_KIND,
  LINKAUTH_PERMISSION,
  normalizeAudience,
} from "@linky-fit/linkauth/signer";
import { Either, Option, Schema } from "effect";
import { decrypt, encrypt, getConversationKey } from "nostr-tools/nip44";
import { isPubkey, RelayUrl } from "../domain/primitives";
import type { EventId, Pubkey, UnixSeconds } from "../domain/primitives";
import { firstTagValue, NostrTags } from "../internal/nostrEvent";
import type { SignedPlainEvent } from "../internal/nostrEvent";
import {
  decodeVerifiedPlainEvent,
  signPlainEvent,
} from "../internal/plainEvent";
import type { PlainEventTemplate } from "../internal/plainEvent";
import type { LinkstrIdentityService } from "../services/LinkstrIdentity";
import { DeviceAuthorization, NostrConnectRequest } from "./domain";

/** NIP-46 plain event kind; payment notices share the number only inside gift wraps. */
export const NOSTR_CONNECT_KIND = 24133;

const MAX_RELAYS = 5;

/**
 * Linky-invented kind binding the signer's key to a device key of the app
 * the user approved; never published by the signer. Signed only on the
 * explicit `sign_event:24138` permission, which the approval names.
 */
export const DEVICE_AUTHORIZATION_KIND = 24138;
export const DEVICE_AUTHORIZATION_VALUE = "device_authorization";
export const DEVICE_AUTHORIZATION_PERMISSION = `sign_event:${DEVICE_AUTHORIZATION_KIND}`;

/** The one template a signer signs for a device authorization; nothing else rides along. */
export const deviceAuthorizationTemplate = (args: {
  readonly device: Pubkey;
  /** The app's `name`, exactly as its `nostrconnect://` link states it. */
  readonly app: string;
}): PlainEventTemplate => ({
  kind: DEVICE_AUTHORIZATION_KIND,
  tags: [
    ["linky", DEVICE_AUTHORIZATION_VALUE],
    ["p", args.device],
    ["app", args.app],
  ],
  content: "",
});

/** Whether approving the request also lets the site link one of its devices. */
export const requestsDeviceAuthorization = (
  request: NostrConnectRequest,
): boolean => request.perms.includes(DEVICE_AUTHORIZATION_PERMISSION);

/**
 * The origin a site login would be bound to when the link explicitly asks
 * for `sign_event:24139` and its `url` is an acceptable site; null otherwise.
 */
export const linkauthAudience = (
  request: NostrConnectRequest,
): string | null =>
  request.url !== null && request.perms.includes(LINKAUTH_PERMISSION)
    ? normalizeAudience(request.url)
    : null;

/** What a template authorizes when it is exactly the canonical shape. */
const authorizationOf = (
  template: PlainEventTemplate,
): { readonly device: Pubkey; readonly app: string } | null => {
  const device = firstTagValue(template.tags, "p");
  const app = firstTagValue(template.tags, "app");
  if (device === null || !isPubkey(device) || app === null) return null;
  const canonical = deviceAuthorizationTemplate({ device, app });
  return template.kind === canonical.kind &&
    template.content === canonical.content &&
    JSON.stringify(template.tags) === JSON.stringify(canonical.tags)
    ? { device, app }
    : null;
};

const parseJsonOrRaw = (raw: unknown): unknown => {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/**
 * A signed device authorization (or its JSON text), verified: signature,
 * kind and exact shape. Null otherwise. Whether its author may act for the
 * verifier is the verifier's call.
 */
export const verifyDeviceAuthorization = (
  raw: unknown,
): DeviceAuthorization | null => {
  const event = Either.getOrNull(decodeVerifiedPlainEvent(parseJsonOrRaw(raw)));
  if (event === null) return null;
  const authorization = authorizationOf(event);
  if (authorization === null) return null;
  return new DeviceAuthorization({
    eventId: event.id,
    author: event.pubkey,
    ...authorization,
    createdAt: event.created_at,
    event,
  });
};

const decodeRequest = Schema.decodeUnknownOption(NostrConnectRequest);
const isRelayUrl = Schema.is(RelayUrl);

const optionalParam = (uri: URL, name: string): string | null => {
  const value = uri.searchParams.get(name)?.trim() ?? "";
  return value.length > 0 ? value : null;
};

/** Null for anything that is not a usable `nostrconnect://` login request. */
export const parseNostrConnectUri = (
  text: string,
): NostrConnectRequest | null => {
  let uri: URL;
  try {
    uri = new URL(text.trim());
  } catch {
    return null;
  }
  if (uri.protocol !== "nostrconnect:") return null;
  const relays = [
    ...new Set(uri.searchParams.getAll("relay").map((relay) => relay.trim())),
  ];
  const perms = (uri.searchParams.get("perms") ?? "")
    .split(",")
    .map((perm) => perm.trim())
    .filter((perm) => perm.length > 0);
  return Option.getOrNull(
    decodeRequest({
      // Non-special URL schemes keep the host's case.
      clientPubkey: uri.hostname.toLowerCase(),
      relays: relays.filter(isRelayUrl).slice(0, MAX_RELAYS),
      secret: uri.searchParams.get("secret") ?? "",
      perms,
      name: optionalParam(uri, "name"),
      url: optionalParam(uri, "url"),
      image: optionalParam(uri, "image"),
    }),
  );
};

const RpcRequest = Schema.parseJson(
  Schema.Struct({
    id: Schema.String,
    method: Schema.String,
    params: Schema.optionalWith(Schema.Array(Schema.String), {
      default: () => [],
    }),
  }),
);
export type NostrConnectRpcRequest = typeof RpcRequest.Type;
const decodeRpcRequest = Schema.decodeUnknownOption(RpcRequest);

export type NostrConnectRpcResponse =
  | { readonly id: string; readonly result: string }
  | { readonly id: string; readonly error: string };

/** The identity and one client, with their NIP-44 conversation key. */
export interface NostrConnectChannel {
  readonly identity: LinkstrIdentityService;
  readonly clientPubkey: Pubkey;
  readonly conversationKey: Uint8Array;
}

export const openNostrConnectChannel = (
  identity: LinkstrIdentityService,
  clientPubkey: Pubkey,
): NostrConnectChannel => ({
  identity,
  clientPubkey,
  conversationKey: getConversationKey(identity.secretKey, clientPubkey),
});

export const encodeNostrConnectEvent = (
  channel: NostrConnectChannel,
  response: NostrConnectRpcResponse,
  now: UnixSeconds,
): SignedPlainEvent =>
  signPlainEvent(
    {
      kind: NOSTR_CONNECT_KIND,
      tags: [["p", channel.clientPubkey]],
      content: encrypt(JSON.stringify(response), channel.conversationKey),
    },
    now,
    channel.identity.secretKey,
  );

/** Null for forged, foreign, NIP-04 or malformed events: callers ignore them. */
export const decodeNostrConnectRequest = (
  channel: NostrConnectChannel,
  raw: unknown,
): {
  readonly eventId: EventId;
  readonly rpc: NostrConnectRpcRequest;
} | null => {
  const event = Either.getOrNull(decodeVerifiedPlainEvent(raw));
  if (
    event === null ||
    event.kind !== NOSTR_CONNECT_KIND ||
    event.pubkey !== channel.clientPubkey
  ) {
    return null;
  }
  let plaintext: string;
  try {
    plaintext = decrypt(event.content, channel.conversationKey);
  } catch {
    return null;
  }
  return Option.match(decodeRpcRequest(plaintext), {
    onNone: () => null,
    onSome: (rpc) => ({ eventId: event.id, rpc }),
  });
};

const SignTemplate = Schema.parseJson(
  Schema.Struct({ kind: Schema.Int, content: Schema.String, tags: NostrTags }),
);
const decodeSignTemplate = Schema.decodeUnknownEither(SignTemplate);

const deviceAuthorizationPolicy = (
  request: NostrConnectRequest,
  template: PlainEventTemplate,
): Either.Either<PlainEventTemplate, string> => {
  // A blanket `sign_event` (or no perms) never covers it: the approval
  // screen announces the device link only for the explicit permission.
  if (!requestsDeviceAuthorization(request)) {
    return Either.left(`${DEVICE_AUTHORIZATION_PERMISSION} was not requested`);
  }
  if (request.name === null) {
    return Either.left("a device authorization needs the app's name");
  }
  const authorization = authorizationOf(template);
  if (authorization === null) {
    return Either.left("invalid device authorization");
  }
  return authorization.app === request.name
    ? Either.right(template)
    : Either.left("app tag does not match the approved name");
};

const linkauthPolicy = (
  request: NostrConnectRequest,
  template: PlainEventTemplate,
): Either.Either<PlainEventTemplate, string> => {
  // A blanket `sign_event` (or no perms) never covers it, as for device authorizations.
  if (!request.perms.includes(LINKAUTH_PERMISSION)) {
    return Either.left(`${LINKAUTH_PERMISSION} was not requested`);
  }
  if (request.url === null || normalizeAudience(request.url) === null) {
    return Either.left("a login needs the site's url");
  }
  return isCanonicalAuthTemplate(template, request.url)
    ? Either.right(template)
    : Either.left("invalid login template");
};

const signableTemplate = (
  request: NostrConnectRequest,
  param: string | undefined,
): Either.Either<PlainEventTemplate, string> =>
  Either.gen(function* () {
    const template = yield* decodeSignTemplate(param).pipe(
      Either.mapLeft(() => "invalid event template"),
    );
    switch (template.kind) {
      case DEVICE_AUTHORIZATION_KIND:
        return yield* deviceAuthorizationPolicy(request, template);
      case LINKAUTH_KIND:
        return yield* linkauthPolicy(request, template);
      default:
        return yield* Either.left(`kind ${template.kind} is not allowed`);
    }
  });

/** What answering one request means for the login. */
export type NostrConnectOutcome =
  | { readonly _tag: "Answered" }
  | { readonly _tag: "PublicKeyShared" }
  | {
      readonly _tag: "Signed";
      readonly kind: number;
      /** The device a signed device authorization names; null for site logins. */
      readonly device: Pubkey | null;
    }
  | { readonly _tag: "Refused"; readonly reason: string };

export interface NostrConnectAnswer {
  readonly response: NostrConnectRpcResponse;
  readonly outcome: NostrConnectOutcome;
}

/**
 * Login policy: share the pubkey, sign only the canonical linkauth login for
 * the link's own `url` and the device authorization, each on its explicit
 * permission (`created_at` = `now`), refuse other signatures, and answer
 * anything else with an error the login survives.
 */
export const answerNostrConnectRequest = (
  request: NostrConnectRequest,
  identity: LinkstrIdentityService,
  rpc: NostrConnectRpcRequest,
  now: UnixSeconds,
): NostrConnectAnswer => {
  const answer = (
    result: string,
    outcome: NostrConnectOutcome,
  ): NostrConnectAnswer => ({ response: { id: rpc.id, result }, outcome });
  switch (rpc.method) {
    case "get_public_key":
      return answer(identity.pubkey, { _tag: "PublicKeyShared" });
    case "ping":
      return answer("pong", { _tag: "Answered" });
    case "connect":
      return answer("ack", { _tag: "Answered" });
    case "sign_event":
      return Either.match(signableTemplate(request, rpc.params[0]), {
        onLeft: (reason) => ({
          response: { id: rpc.id, error: reason },
          outcome: { _tag: "Refused", reason },
        }),
        onRight: (template) => {
          const event = signPlainEvent(template, now, identity.secretKey);
          return answer(JSON.stringify(event), {
            _tag: "Signed",
            kind: event.kind,
            device:
              event.kind === DEVICE_AUTHORIZATION_KIND
                ? (authorizationOf(event)?.device ?? null)
                : null,
          });
        },
      });
    default:
      return {
        response: { id: rpc.id, error: `unsupported method ${rpc.method}` },
        outcome: { _tag: "Answered" },
      };
  }
};
