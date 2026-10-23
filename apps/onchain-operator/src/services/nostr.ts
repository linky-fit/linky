import {
  AppData,
  CashuTokenText,
  encodeNprofile,
  Outbox,
  OutboxRef,
  PaymentNoticeDraft,
  PaymentNotices,
  PaymentRequestPayloadText,
  ProfileMetadata,
  Profiles,
  TextMessageDraft,
  TokenMessageDraft,
  UnixSeconds,
  WrapInbox,
} from "@linky-fit/linkstr";
import type {
  AppDataDraft,
  AppMessageDraft,
  ClientId,
  EnqueueReceipt,
  InboxDelivery,
  MessageText,
  RumorFixedOperation,
  OutboxResult,
  Pubkey,
  RelayUrl,
  WrapInboxEvent,
} from "@linky-fit/linkstr";
import { Cause, Effect, Schema, Stream } from "effect";
import { nowSeconds } from "../utils/time";
import type { LinkstrRuntime } from "./runtimes";

/** A first session with no stored cursor reads this far back. */
const LOOKBACK_SECONDS = 7 * 24 * 60 * 60;

/**
 * Handles one inbox event. The event is acknowledged once every handler
 * resolved; a rejection leaves it for the next session to replay, so
 * handlers must be idempotent.
 */
export type InboxHandler = (
  event: WrapInboxEvent,
  delivery: InboxDelivery,
) => Promise<void> | void;

/** Handles a finished outbox job; it is acknowledged once the handler resolved. */
export type OutboxResultHandler = (
  result: OutboxResult,
) => Promise<void> | void;

const TokenText = Schema.Union([CashuTokenText, PaymentRequestPayloadText]);

/** This device on Nostr: one inbox read while the app is open, one durable outbox. */
export interface Nostr {
  readonly pubkey: Pubkey;
  /** The account's nprofile with the app relays, the transport of the operator's payment requests. */
  readonly nprofile: string;
  /**
   * Queues a cashu token or NUT-18 payment payload as a NIP-17 chat message,
   * the way Linky sends them; `recipientRelays` also get the recipient copy.
   */
  readonly sendToken: (
    to: Pubkey,
    token: string,
    ref: string,
    recipientRelays?: readonly RelayUrl[],
  ) => Promise<EnqueueReceipt>;
  /** Queues a NIP-17 text message, the way Linky sends chat text. */
  readonly sendText: (
    to: Pubkey,
    text: MessageText,
    clientId: ClientId,
    ref: string,
  ) => Promise<EnqueueReceipt>;
  /** Queues a linkstr app message, e.g. a transfer update. */
  readonly sendAppMessage: (
    draft: AppMessageDraft,
    ref: string,
  ) => Promise<EnqueueReceipt>;
  /**
   * Publishes the account's kind 0 profile with `name` and `picture` (none
   * removes it), keeping every other field of the newest one on the relays;
   * `false` when that one could not be read or no relay took the new one.
   */
  readonly publishProfile: (profile: {
    readonly name: string;
    readonly picture: string | null;
  }) => Promise<boolean>;
  /** The newest kind 0 of each pubkey that has one; rejects when no relay answered. */
  readonly fetchProfiles: (
    pubkeys: readonly Pubkey[],
  ) => Promise<ReadonlyMap<Pubkey, ProfileMetadata>>;
  /** Publishes NIP-78 app data; `false` when no relay took it. */
  readonly publishAppData: (draft: AppDataDraft) => Promise<boolean>;
  /** Wakes the recipient's Linky after a token reached a relay; best effort. */
  readonly sendPaymentNotice: (to: Pubkey) => Promise<void>;
  readonly onInboxEvent: (handler: InboxHandler) => () => void;
  /** Results of jobs whose ref starts with `refPrefix`. */
  readonly onOutboxResult: (
    refPrefix: string,
    handler: OutboxResultHandler,
  ) => () => void;
  /** Opens the inbox and starts consuming outbox results; once. */
  readonly start: () => void;
}

const subscribe = <T>(handlers: Set<T>, handler: T) => {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
};

/** Runs every task and reports whether all of them succeeded. */
const settleAll = async (
  label: string,
  tasks: ReadonlyArray<() => Promise<void> | void>,
): Promise<boolean> => {
  const outcomes = await Promise.allSettled(tasks.map(async (task) => task()));
  const failures = outcomes.flatMap((outcome) =>
    outcome.status === "rejected" ? [outcome.reason] : [],
  );
  for (const reason of failures)
    console.warn(`[onchain-operator] ${label}`, reason);
  return failures.length === 0;
};

const logDeath = (label: string) =>
  Effect.catchCause((cause: Cause.Cause<unknown>) =>
    Effect.sync(() => {
      if (!Cause.hasInterruptsOnly(cause)) {
        console.warn(
          `[onchain-operator] ${label} stopped`,
          Cause.pretty(cause),
        );
      }
    }),
  );

export const createNostr = ({
  runtime,
  pubkey,
  relays,
}: {
  readonly runtime: LinkstrRuntime;
  readonly pubkey: Pubkey;
  readonly relays: readonly RelayUrl[];
}): Nostr => {
  const inboxHandlers = new Set<InboxHandler>();
  const outboxHandlers = new Set<{
    readonly refPrefix: string;
    readonly handler: OutboxResultHandler;
  }>();

  const readInbox = Effect.scoped(
    Effect.gen(function* () {
      const inbox = yield* WrapInbox;
      const feed = yield* inbox.open({
        since: UnixSeconds.make(nowSeconds() - LOOKBACK_SECONDS),
      });
      yield* Stream.runForEach(feed.events, ({ event, delivery, ack }) =>
        Effect.promise(() =>
          settleAll(
            "inbox handler failed",
            [...inboxHandlers].map((handler) => () => handler(event, delivery)),
          ),
        ).pipe(Effect.flatMap((handled) => (handled ? ack : Effect.void))),
      );
    }),
  );

  const consumeOutbox = Effect.flatMap(Outbox, (outbox) =>
    Stream.runForEach(outbox.results, (result) =>
      Effect.promise(() =>
        settleAll(
          "outbox result handler failed",
          [...outboxHandlers].flatMap(({ refPrefix, handler }) =>
            result.ref.startsWith(refPrefix) ? [() => handler(result)] : [],
          ),
        ),
      ).pipe(
        Effect.flatMap((handled) =>
          handled ? outbox.ack(result.jobId) : Effect.void,
        ),
      ),
    ),
  );

  const enqueue = (operation: RumorFixedOperation, ref: string) =>
    runtime.runPromise(
      Effect.flatMap(Outbox, (outbox) =>
        outbox.enqueue(operation, OutboxRef.make(ref)),
      ),
    );

  let started = false;

  return {
    pubkey,
    nprofile: encodeNprofile(pubkey, relays),
    sendToken: (to, token, ref, recipientRelays = []) =>
      enqueue(
        {
          _tag: "chat.token",
          draft: new TokenMessageDraft({
            to,
            token: Schema.decodeUnknownSync(TokenText)(token),
            ...(recipientRelays.length > 0
              ? { recipientRelays: [...recipientRelays] }
              : {}),
          }),
        },
        ref,
      ),
    sendText: (to, text, clientId, ref) =>
      enqueue(
        {
          _tag: "chat.text",
          draft: new TextMessageDraft({ to, content: text, clientId }),
        },
        ref,
      ),
    sendAppMessage: (draft, ref) => enqueue({ _tag: "appMessage", draft }, ref),
    publishProfile: ({ name, picture }) =>
      runtime
        .runPromise(
          Effect.gen(function* () {
            const profiles = yield* Profiles;
            const { profile } = yield* profiles.fetchProfile(pubkey);
            yield* profiles.publishProfile(
              new ProfileMetadata({
                ...profile?.metadata,
                name,
                picture: picture ?? undefined,
              }),
            );
          }),
        )
        .then(
          () => true,
          (error: unknown) => {
            console.warn("[onchain-operator] profile not published", error);
            return false;
          },
        ),
    fetchProfiles: (pubkeys) =>
      runtime.runPromise(
        Effect.map(
          Effect.flatMap(Profiles, (profiles) =>
            profiles.fetchProfiles(pubkeys),
          ),
          (entries) =>
            new Map(
              entries.flatMap((entry) =>
                entry.profile === null
                  ? []
                  : [[entry.pubkey, entry.profile.metadata] as const],
              ),
            ),
        ),
      ),
    publishAppData: (draft) =>
      runtime
        .runPromise(
          Effect.flatMap(AppData, (appData) => appData.publish(draft)),
        )
        .then(
          () => true,
          (error: unknown) => {
            console.warn("[onchain-operator] app data not published", error);
            return false;
          },
        ),
    sendPaymentNotice: (to) =>
      runtime
        .runPromise(
          Effect.flatMap(PaymentNotices, (notices) =>
            notices.send(new PaymentNoticeDraft({ to })),
          ),
        )
        .then(
          () => undefined,
          (error: unknown) =>
            console.warn("[onchain-operator] payment notice not sent", error),
        ),
    onInboxEvent: (handler) => subscribe(inboxHandlers, handler),
    onOutboxResult: (refPrefix, handler) =>
      subscribe(outboxHandlers, { refPrefix, handler }),
    start: () => {
      if (started) return;
      started = true;
      runtime.runFork(readInbox.pipe(logDeath("Nostr inbox")));
      runtime.runFork(consumeOutbox.pipe(logDeath("Nostr outbox")));
    },
  };
};
