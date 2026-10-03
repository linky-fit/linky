import {
  InboxCursorStore,
  linkstrServices,
  makeNostrTransportSimplePool,
  MessageText,
  Outbox,
  OutboxRef,
  OutboxStore,
  SupporterBadges,
  SupporterResultDraft,
  TextMessageDraft,
  UnixSeconds,
  WrapInbox,
} from "@linky-fit/linkstr";
import type {
  OutboxResult,
  Pubkey,
  RelayUrl,
  StringStorage,
  WrapInboxEvent,
} from "@linky-fit/linkstr";
import { LINKY_CONTACT_NPUB } from "@linky-fit/supporter";
import { Effect, ManagedRuntime, Option, Schema, Stream } from "effect";
import type { BotIdentity } from "./identity";
import { logInfo, logWarn, shortPubkey } from "./log";
import type { SupporterMessenger } from "./pipeline";
import { TokenHash } from "./storage";

const OUTBOX_KEY = "outbox";
const RESULT_REF_PREFIX = "supporter-result:";

export const supporterResultRef = (tokenHash: TokenHash): OutboxRef =>
  OutboxRef.make(`${RESULT_REF_PREFIX}${tokenHash}`);

const decodeTokenHash = Schema.decodeUnknownOption(TokenHash);

/** The payment a supporter result job answers; null for other jobs. */
export const tokenHashOfRef = (ref: OutboxRef): TokenHash | null =>
  ref.startsWith(RESULT_REF_PREFIX)
    ? Option.getOrNull(decodeTokenHash(ref.slice(RESULT_REF_PREFIX.length)))
    : null;

export interface NostrRuntimeConfig {
  readonly relays: ReadonlyArray<RelayUrl>;
  readonly allowInsecureLocalhostRelays: boolean;
  readonly storage: StringStorage;
}

export const makeNostrRuntime = (
  identity: BotIdentity,
  config: NostrRuntimeConfig,
) =>
  ManagedRuntime.make(
    linkstrServices({
      secretKey: identity.secretKey,
      readRelays: config.relays,
      writeRelays: config.relays,
      transport: makeNostrTransportSimplePool({
        allowInsecureLocalhost: config.allowInsecureLocalhostRelays,
      }),
      outboxStore: OutboxStore.fromStringStorage(config.storage, OUTBOX_KEY),
      inboxCursorStore: InboxCursorStore.fromStringStorage(
        config.storage,
        "inbox_cursor",
      ),
    }),
  );

export type NostrRuntime = ReturnType<typeof makeNostrRuntime>;

/**
 * Feeds every inbox event to `handle` and acks it once handled. A failed
 * event stays unacked, so the next start replays it.
 */
export const runInbox = (
  runtime: NostrRuntime,
  handle: (event: WrapInboxEvent) => Promise<void>,
) =>
  runtime.runFork(
    Effect.scoped(
      Effect.gen(function* () {
        const inbox = yield* WrapInbox;
        const feed = yield* inbox.open({
          since: UnixSeconds.make(Math.floor(Date.now() / 1000)),
        });
        logInfo("inbox open");
        yield* Stream.runForEach(feed.events, ({ event, ack }) =>
          Effect.tryPromise({
            try: () => handle(event),
            catch: (error) => error,
          }).pipe(
            Effect.zipRight(ack),
            Effect.catchAll((error) =>
              Effect.sync(() => logWarn(`inbox ${event._tag} failed`, error)),
            ),
          ),
        );
      }),
    ),
  );

const describeOutboxResult = (result: OutboxResult): string =>
  result._tag === "OutboxJobSucceeded"
    ? `outbox delivered ref=${result.ref}`
    : `outbox gave up ref=${result.ref} reason=${result.reason}`;

/**
 * Logs completed outbox jobs, reports each accepted one to `onSucceeded` and
 * acks it afterwards; a job whose report failed is re-emitted on the next start.
 */
export const consumeOutboxResults = (
  runtime: NostrRuntime,
  onSucceeded: (ref: OutboxRef) => Promise<void>,
) =>
  runtime.runFork(
    Effect.flatMap(Outbox, (outbox) =>
      Stream.runForEach(outbox.results, (result) =>
        Effect.sync(() => logInfo(describeOutboxResult(result))).pipe(
          Effect.zipRight(
            result._tag === "OutboxJobSucceeded"
              ? Effect.tryPromise({
                  try: () => onSucceeded(result.ref),
                  catch: (error) => error,
                })
              : Effect.void,
          ),
          Effect.zipRight(outbox.ack(result.jobId)),
          Effect.catchAll((error) =>
            Effect.sync(() => logWarn(`outbox result ${result.ref}`, error)),
          ),
        ),
      ),
    ),
  );

export const createMessenger = (
  runtime: NostrRuntime,
  storage: StringStorage,
): SupporterMessenger => {
  // The outbox keeps every job here until it is acked, so a ref found here
  // is already queued; enqueueing it again would send the result twice.
  const outboxJobs = Effect.runSync(
    Effect.provide(
      OutboxStore,
      OutboxStore.fromStringStorage(storage, OUTBOX_KEY),
    ),
  );
  return {
    signAwards: (supporter, tier, awardedAt) =>
      runtime.runPromise(
        Effect.flatMap(SupporterBadges, (badges) =>
          badges.signAwards(supporter, tier, awardedAt),
        ),
      ),
    sendResult: ({ to, tokenMessageId, tokenHash, result }) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const ref = supporterResultRef(tokenHash);
          if ((yield* outboxJobs.loadAll).some((job) => job.ref === ref))
            return;
          yield* Effect.flatMap(Outbox, (outbox) =>
            outbox.enqueue(
              {
                _tag: "supporterResult",
                draft: new SupporterResultDraft({
                  to,
                  tokenMessageId,
                  result,
                }),
              },
              ref,
            ),
          );
        }),
      ),
  };
};

export const AUTO_REPLY_TEXT = `Hi, this is Linky Bot. I only handle supporter payments, so nobody reads messages here. For feedback and questions, write to Linky: nostr:${LINKY_CONTACT_NPUB}`;

export const sendAutoReply =
  (runtime: NostrRuntime) =>
  (to: Pubkey, day: string): Promise<void> =>
    runtime.runPromise(
      Effect.flatMap(Outbox, (outbox) =>
        outbox.enqueue(
          {
            _tag: "chat.text",
            draft: new TextMessageDraft({
              to,
              content: MessageText.make(AUTO_REPLY_TEXT),
            }),
          },
          OutboxRef.make(`auto-reply:${shortPubkey(to)}:${day}`),
        ),
      ).pipe(Effect.asVoid),
    );
