import {
  DEFAULT_NOSTR_RELAYS,
  Chat,
  CashuTokenText,
  ClientId,
  decodeNpub,
  NostrSecretKey,
  Outbox,
  OutboxRef,
  OutboxStore,
  PAYMENT_ANALYTICS_RECIPIENT_NPUB,
  PaymentTelemetryDraft,
  RelayUrl,
  runLinkstr,
  TokenMessageDraft,
  UnixSeconds,
  classifyPaymentErrorCode,
  detectTelemetryEnvironment,
} from "@linky/linkstr";
import type {
  PaymentTelemetryDirection,
  PaymentTelemetryMethod,
  PaymentTelemetryPhase,
  PaymentTelemetryStatus,
} from "@linky/linkstr";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { Effect, Schema, Stream } from "effect";
export { PAYMENT_ANALYTICS_RECIPIENT_NPUB } from "@linky/linkstr";

const key = "linky.site.nostr.secret";
const secretHex = Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/));
const config = () => {
  const stored = localStorage.getItem(key);
  const secretKey = NostrSecretKey.make(
    stored === null
      ? crypto.getRandomValues(new Uint8Array(32))
      : hexToBytes(Schema.decodeUnknownSync(secretHex)(stored)),
  );
  if (stored === null) localStorage.setItem(key, bytesToHex(secretKey));
  const relays = (
    import.meta.env.VITE_NOSTR_RELAYS || DEFAULT_NOSTR_RELAYS.join(",")
  )
    .split(",")
    .map((url: string) => RelayUrl.make(url.trim()));
  return {
    secretKey,
    readRelays: relays,
    writeRelays: relays,
    outboxStore: OutboxStore.fromStringStorage(
      localStorage,
      "linky.site.outbox.v1",
    ),
  };
};
const recipient = () => {
  const pubkey = decodeNpub(PAYMENT_ANALYTICS_RECIPIENT_NPUB);
  if (!pubkey) throw new Error("Invalid telemetry recipient");
  return pubkey;
};
interface QueuePaymentTelemetryArgs {
  amount?: number | null;
  direction: PaymentTelemetryDirection;
  error?: string | null;
  fee?: number | null;
  method: PaymentTelemetryMethod;
  mint?: string | null;
  phase: PaymentTelemetryPhase;
  status: PaymentTelemetryStatus;
}
const AMOUNT_BUCKETS = [1, 10, 100, 1_000, 10_000, 100_000];
const FEE_BUCKETS = [1, 5, 10, 25, 100, 500];
const clampBucket = (value: number, buckets: readonly number[]): string => {
  for (const bucket of buckets) {
    if (value <= bucket) {
      return `lte_${bucket}`;
    }
  }

  const lastBucket = buckets.at(-1);
  return lastBucket ? `gt_${lastBucket}` : "unknown";
};

const bucketPositiveNumber = (
  value: number | null | undefined,
  buckets: readonly number[],
): string | null => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return clampBucket(Math.floor(value), buckets);
};

const bufferKey = "linky.site.pendingPaymentTelemetry.v1";
const BufferedDraft = Schema.Struct({
  ...PaymentTelemetryDraft.fields,
  appHost: Schema.optionalWith(PaymentTelemetryDraft.fields.appHost, {
    default: () => null,
  }),
  devicePlatform: Schema.optionalWith(
    PaymentTelemetryDraft.fields.devicePlatform,
    { default: () => null },
  ),
  appRuntime: Schema.optionalWith(PaymentTelemetryDraft.fields.appRuntime, {
    default: () => null,
  }),
});
const DraftsJson = Schema.parseJson(Schema.Array(BufferedDraft));
const readBuffer = () => {
  const raw = localStorage.getItem(bufferKey);
  if (!raw) return [];
  const result = Schema.decodeUnknownOption(DraftsJson)(raw);
  return result._tag === "Some" ? result.value : [];
};
const deliver = async (): Promise<void> => {
  await navigator.locks.request("linky.site.outbox", () =>
    runLinkstr(
      config(),
      Effect.gen(function* () {
        const outbox = yield* Outbox;
        for (const item of readBuffer()) {
          yield* outbox.enqueueTelemetry(
            new PaymentTelemetryDraft(item),
            recipient(),
            OutboxRef.make(`telemetry:${item.id}`),
          );
          localStorage.setItem(
            bufferKey,
            Schema.encodeSync(DraftsJson)(
              readBuffer().filter((draft) => draft.id !== item.id),
            ),
          );
        }
        yield* Stream.runForEach(outbox.results, (result) =>
          outbox.ack(result.jobId),
        ).pipe(Effect.timeoutOption("8 seconds"));
      }),
    ),
  );
};
let flushPromise: Promise<void> | null = null;
export const flushPaymentTelemetryQueue = (): Promise<void> => {
  flushPromise ??= deliver()
    .catch(() => undefined)
    .finally(() => {
      flushPromise = null;
    });
  return flushPromise;
};
const getTelemetryEnvironment = () =>
  detectTelemetryEnvironment({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    displayModeStandalone: window.matchMedia("(display-mode: standalone)")
      .matches,
    navigatorStandalone: Reflect.get(navigator, "standalone") === true,
    nativePlatform: null,
  });
export const queuePaymentTelemetry = (
  args: QueuePaymentTelemetryArgs,
): void => {
  const { devicePlatform, appRuntime } = getTelemetryEnvironment();
  const draft = new PaymentTelemetryDraft({
    id: ClientId.make(crypto.randomUUID()),
    createdAtSec: UnixSeconds.make(Math.floor(Date.now() / 1000)),
    direction: args.direction,
    status: args.status,
    method: args.method,
    phase: args.phase,
    mint: args.mint ?? null,
    amountBucket: bucketPositiveNumber(args.amount, AMOUNT_BUCKETS),
    feeBucket: bucketPositiveNumber(args.fee, FEE_BUCKETS),
    errorCode: classifyPaymentErrorCode(args.error),
    errorDetail: args.error?.slice(0, 500) ?? null,
    appHost: window.location.host,
    devicePlatform,
    appRuntime,
    appVersion: __APP_VERSION__,
  });
  try {
    localStorage.setItem(
      bufferKey,
      Schema.encodeSync(DraftsJson)([...readBuffer(), draft].slice(-250)),
    );
    void flushPaymentTelemetryQueue();
  } catch {
    /* Telemetry never blocks the payment result. */
  }
};
export const forwardCashuTokenPrivately = async (args: {
  recipientNpub: string;
  token: string;
}): Promise<void> => {
  const to = decodeNpub(args.recipientNpub);
  if (!to) throw new Error("Invalid npub");
  const { readRelays, writeRelays } = config();
  const secretKey = NostrSecretKey.make(
    crypto.getRandomValues(new Uint8Array(32)),
  );
  await runLinkstr(
    { secretKey, readRelays, writeRelays },
    Effect.flatMap(Chat, (chat) =>
      chat.sendToken(
        new TokenMessageDraft({ to, token: CashuTokenText.make(args.token) }),
      ),
    ),
  );
};
