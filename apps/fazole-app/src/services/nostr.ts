import {
  CashuTokenText,
  encodeNprofile,
  Outbox,
  OutboxRef,
  OutboxStore,
  PaymentNoticeDraft,
  PaymentNotices,
  ProfileMetadata,
  Profiles,
  TokenMessageDraft,
  UnixSeconds,
  WrapInbox,
} from "@linky-fit/linkstr";
import type {
  EnqueueReceipt,
  InboxDelivery,
  OutboxResult,
  Pubkey,
  RelayUrl,
  WrapInboxEvent,
} from "@linky-fit/linkstr";
import { Cause, Duration, Effect, Layer, Stream } from "effect";
import { nowSeconds } from "../utils/time";
import type { LinkstrRuntime } from "./runtimes";

/** How long a payer's profile may take before the screen goes on without it. */
const PROFILE_TIMEOUT = Duration.seconds(8);

/** Who paid, as their kind-0 profile names them; either field may be missing. */
export interface PayerProfile {
  readonly name: string | null;
  readonly picture: string | null;
}

/** A first session with no stored cursor reads this far back. */
const LOOKBACK_SECONDS = 3 * 24 * 60 * 60;

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

/** This device on Nostr: one inbox read while the app is open, one durable outbox. */
export interface Nostr {
  readonly pubkey: Pubkey;
  /** The account's nprofile with the app relays, where customers' wallets send tokens. */
  readonly nprofile: string;
  /** Queues a cashu token as a NIP-17 chat message, the way Linky sends tokens. */
  readonly sendToken: (
    to: Pubkey,
    token: string,
    ref: string,
  ) => Promise<EnqueueReceipt>;
  /** Wakes the recipient's Linky after a token reached a relay; best effort. */
  readonly sendPaymentNotice: (to: Pubkey) => Promise<void>;
  /** The refs of outbox jobs still stored, delivered or not. */
  readonly queuedRefs: () => Promise<ReadonlySet<string>>;
  /** Publishes the account's kind-0 name, so wallets show the shop instead of a stranger. */
  readonly publishName: (name: string) => Promise<void>;
  /** Someone's kind-0 name and picture; `null` when they have none or no relay answered in time. */
  readonly fetchProfile: (pubkey: Pubkey) => Promise<PayerProfile | null>;
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
  for (const reason of failures) console.warn(`[fazole] ${label}`, reason);
  return failures.length === 0;
};

const logDeath = (label: string) =>
  Effect.catchCause((cause: Cause.Cause<unknown>) =>
    Effect.sync(() => {
      if (!Cause.hasInterruptsOnly(cause)) {
        console.warn(`[fazole] ${label} stopped`, Cause.pretty(cause));
      }
    }),
  );

export const createNostr = ({
  runtime,
  pubkey,
  relays,
  outboxStore,
}: {
  readonly runtime: LinkstrRuntime;
  readonly pubkey: Pubkey;
  readonly relays: readonly RelayUrl[];
  /** The outbox store the runtime was built with, read to tell which jobs are still queued. */
  readonly outboxStore: Layer.Layer<OutboxStore>;
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

  let started = false;

  return {
    pubkey,
    nprofile: encodeNprofile(pubkey, relays),
    sendToken: (to, token, ref) =>
      runtime.runPromise(
        Effect.flatMap(Outbox, (outbox) =>
          outbox.enqueue(
            {
              _tag: "chat.token",
              draft: new TokenMessageDraft({
                to,
                token: CashuTokenText.make(token),
              }),
            },
            OutboxRef.make(ref),
          ),
        ),
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
            console.warn("[fazole] payment notice not sent", error),
        ),
    queuedRefs: () =>
      Effect.runPromise(
        Effect.flatMap(OutboxStore, (store) => store.loadAll).pipe(
          Effect.provide(outboxStore),
          Effect.map((jobs) => new Set(jobs.map((job) => job.ref))),
        ),
      ),
    fetchProfile: (peer) =>
      runtime
        .runPromise(
          Effect.flatMap(Profiles, (profiles) =>
            profiles.fetchProfile(peer),
          ).pipe(Effect.timeout(PROFILE_TIMEOUT)),
        )
        .then(
          (result): PayerProfile | null => {
            const metadata = result.profile?.metadata;
            return metadata
              ? {
                  name: metadata.displayName || metadata.name || null,
                  picture: metadata.picture || null,
                }
              : null;
          },
          () => null,
        ),
    publishName: (name) =>
      runtime
        .runPromise(
          Effect.flatMap(Profiles, (profiles) =>
            profiles.publishProfile(
              new ProfileMetadata({ name, displayName: name }),
            ),
          ),
        )
        .then(
          () => undefined,
          (error: unknown) =>
            console.warn("[fazole] profile not published", error),
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
