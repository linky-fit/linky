import type {
  NativePushSubscriptionData,
  NativeSubscribeRequestBody,
  NativeUnsubscribeRequestBody,
  OwnershipProofInput,
  ProofAction,
  SubscribeRequestBody,
  UnsubscribeRequestBody,
  WebPushSubscriptionData,
} from "./types";

export class RequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function isRecord(
  value: unknown,
): value is Record<string | number | symbol, unknown> {
  return typeof value === "object" && value !== null;
}

function isHexString(value: string, length: number): boolean {
  const pattern = new RegExp(`^[a-f0-9]{${length}}$`);
  return pattern.test(value);
}

function readString(
  value: unknown,
  fieldName: string,
  status = 400,
  code = "invalid_request",
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RequestError(
      status,
      code,
      `${fieldName} must be a non-empty string`,
    );
  }
  return value;
}

function readOptionalString(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RequestError(
      400,
      "invalid_request",
      "Optional string fields must be non-empty when provided",
    );
  }
  return value;
}

function readStringWithMaxLength(
  value: unknown,
  fieldName: string,
  maxLength: number,
): string {
  const normalized = readString(value, fieldName);
  if (normalized.length > maxLength) {
    throw new RequestError(
      400,
      "invalid_request",
      `${fieldName} exceeds max length ${maxLength}`,
    );
  }
  return normalized;
}

function readBoolean(
  value: unknown,
  fieldName: string,
  fallback = false,
): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "boolean") {
    throw new RequestError(
      400,
      "invalid_request",
      `${fieldName} must be a boolean`,
    );
  }
  return value;
}

function readNumber(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RequestError(
      400,
      "invalid_request",
      `${fieldName} must be a number`,
    );
  }
  return value;
}

function readNullableNumber(value: unknown, fieldName: string): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  return readNumber(value, fieldName);
}

function readStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value)) {
    throw new RequestError(
      400,
      "invalid_request",
      `${fieldName} must be an array`,
    );
  }

  const out: string[] = [];
  for (const item of value) {
    out.push(readString(item, fieldName));
  }
  return out;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    out.push(value);
  }

  return out;
}

export function readProofAction(value: unknown): ProofAction {
  if (value === undefined) {
    return "subscribe";
  }
  if (value === "subscribe" || value === "unsubscribe") {
    return value;
  }
  throw new RequestError(
    400,
    "invalid_request",
    "action must be either subscribe or unsubscribe",
  );
}

export function readPubkey(value: unknown, fieldName = "pubkey"): string {
  const pubkey = readString(value, fieldName);
  if (!isHexString(pubkey, 64)) {
    throw new RequestError(
      400,
      "invalid_request",
      `${fieldName} must be a 64-character lowercase hex pubkey`,
    );
  }
  return pubkey;
}

function readWebPushSubscription(value: unknown): WebPushSubscriptionData {
  if (!isRecord(value)) {
    throw new RequestError(
      400,
      "invalid_request",
      "subscription must be an object",
    );
  }

  const keysValue = value.keys;
  if (!isRecord(keysValue)) {
    throw new RequestError(
      400,
      "invalid_request",
      "subscription.keys must be an object",
    );
  }

  return {
    endpoint: readString(value.endpoint, "subscription.endpoint"),
    expirationTime: readNullableNumber(
      value.expirationTime,
      "subscription.expirationTime",
    ),
    keys: {
      p256dh: readString(keysValue.p256dh, "subscription.keys.p256dh"),
      auth: readString(keysValue.auth, "subscription.keys.auth"),
    },
  };
}

function readNativePushSubscription(
  value: unknown,
): NativePushSubscriptionData {
  if (!isRecord(value)) {
    throw new RequestError(400, "invalid_request", "device must be an object");
  }

  const platform = readString(value.platform, "device.platform");
  if (platform !== "android") {
    throw new RequestError(
      400,
      "invalid_request",
      "device.platform must be android",
    );
  }

  return {
    platform,
    token: readStringWithMaxLength(value.token, "device.token", 4096),
  };
}

function readOwnershipProofs(value: unknown): OwnershipProofInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new RequestError(
      400,
      "invalid_request",
      "proofs must be a non-empty array",
    );
  }

  const out: OwnershipProofInput[] = [];
  for (const proofValue of value) {
    if (!isRecord(proofValue)) {
      throw new RequestError(
        400,
        "invalid_request",
        "Each proof must be an object",
      );
    }
    out.push({
      pubkey: readPubkey(proofValue.pubkey, "proof.pubkey"),
      event: proofValue.event,
    });
  }
  return out;
}

type RequestBody = Record<string | number | symbol, unknown>;

function readRequestBody(value: unknown): RequestBody {
  if (!isRecord(value)) {
    throw new RequestError(400, "invalid_request", "Body must be an object");
  }
  return value;
}

function readRecipientPubkeys(value: unknown): string[] {
  const recipientPubkeys = uniqueStrings(
    readStringArray(value, "recipientPubkeys").map((pubkey) =>
      readPubkey(pubkey, "recipientPubkeys[]"),
    ),
  );

  if (recipientPubkeys.length === 0) {
    throw new RequestError(
      400,
      "invalid_request",
      "recipientPubkeys must contain at least one pubkey",
    );
  }

  return recipientPubkeys;
}

function readOwnershipRequest(body: RequestBody): {
  recipientPubkeys: string[];
  proofs: OwnershipProofInput[];
} {
  return {
    recipientPubkeys: readRecipientPubkeys(body.recipientPubkeys),
    proofs: readOwnershipProofs(body.proofs),
  };
}

function readSubscribeRequestBase(body: RequestBody): {
  cleanupLegacySubscriptions: boolean;
  installationId: string | null;
  recipientPubkeys: string[];
  proofs: OwnershipProofInput[];
} {
  return {
    ...readOwnershipRequest(body),
    cleanupLegacySubscriptions: readBoolean(
      body.cleanupLegacySubscriptions,
      "cleanupLegacySubscriptions",
      false,
    ),
    installationId: readOptionalString(body.installationId),
  };
}

export function readSubscribeRequest(value: unknown): SubscribeRequestBody {
  const body = readRequestBody(value);
  return {
    ...readSubscribeRequestBase(body),
    subscription: readWebPushSubscription(body.subscription),
  };
}

export function readNativeSubscribeRequest(
  value: unknown,
): NativeSubscribeRequestBody {
  const body = readRequestBody(value);
  return {
    ...readSubscribeRequestBase(body),
    device: readNativePushSubscription(body.device),
  };
}

function readEndpointOrSubscriptionEndpoint(value: RequestBody): string {
  const endpoint = readOptionalString(value.endpoint);
  const subscriptionValue = value.subscription;

  if (subscriptionValue === undefined) {
    if (endpoint === null) {
      throw new RequestError(
        400,
        "invalid_request",
        "endpoint or subscription.endpoint is required",
      );
    }
    return endpoint;
  }

  const subscription = readWebPushSubscription(subscriptionValue);
  if (endpoint !== null && endpoint !== subscription.endpoint) {
    throw new RequestError(
      400,
      "invalid_request",
      "endpoint must match subscription.endpoint when both are provided",
    );
  }
  return subscription.endpoint;
}

export function readUnsubscribeRequest(value: unknown): UnsubscribeRequestBody {
  const body = readRequestBody(value);
  return {
    ...readOwnershipRequest(body),
    endpoint: readEndpointOrSubscriptionEndpoint(body),
  };
}

export function readNativeUnsubscribeRequest(
  value: unknown,
): NativeUnsubscribeRequestBody {
  const body = readRequestBody(value);
  return {
    ...readOwnershipRequest(body),
    token: readStringWithMaxLength(body.token, "token", 4096),
  };
}
