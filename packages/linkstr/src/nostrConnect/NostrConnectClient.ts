import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";
import { Deferred, Duration, Effect, Either, Option, Schema } from "effect";
import type { Scope } from "effect";
import { generateSecretKey } from "nostr-tools";
import { decrypt, encrypt, getConversationKey } from "nostr-tools/nip44";
import { RelayRejection } from "../domain/delivery";
import { NostrSecretKey } from "../domain/primitives";
import type { Pubkey } from "../domain/primitives";
import { derivePubkey } from "../identity/codec";
import { Inspector } from "../inspector/Inspector";
import { inspectPlainOperation } from "../internal/inspectPlainOperation";
import { SignedPlainEvent } from "../internal/nostrEvent";
import {
  decodeVerifiedPlainEvent,
  signPlainEvent,
} from "../internal/plainEvent";
import type { PlainEventTemplate } from "../internal/plainEvent";
import { nowSeconds } from "../internal/time";
import { NostrTransport } from "../services/NostrTransport";
import {
  encodeNostrConnectUri,
  NostrConnectRequestNotDelivered,
  NostrConnectSignerTimedOut,
  NostrConnectSignRefused,
} from "./client";
import type {
  NostrConnectClientDraft,
  NostrConnectClientOptions,
  NostrConnectSession,
  NostrConnectSignError,
} from "./client";
import { NOSTR_CONNECT_KIND } from "./codec";
import { NostrConnectRelaysUnreachable } from "./domain";

const CONNECT_TIMEOUT = Duration.minutes(5);
const REPLY_TIMEOUT = Duration.seconds(60);
const SUBSCRIBE_WAIT = Duration.seconds(5);
const SINCE_MARGIN_SECONDS = 60;

const Reply = Schema.parseJson(
  Schema.Struct({
    id: Schema.String,
    result: Schema.optional(Schema.String),
    error: Schema.optional(Schema.String),
  }),
);
const decodeReply = Schema.decodeUnknownOption(Reply);
const decodeSignedEvent = Schema.decodeUnknownOption(
  Schema.parseJson(SignedPlainEvent),
);

type Pending = Deferred.Deferred<
  string,
  NostrConnectSignRefused | NostrConnectRelaysUnreachable
>;

const isSameTemplate = (
  event: SignedPlainEvent,
  template: PlainEventTemplate,
): boolean =>
  event.kind === template.kind &&
  event.content === template.content &&
  JSON.stringify(event.tags) === JSON.stringify(template.tags);

/**
 * The app side of NIP-46: `open` shows a `nostrconnect://` link under a
 * throwaway client key and secret, waits for the user's signer to connect,
 * and relays `sign_event` requests to it. Only replies from the signer that
 * answered with the secret count; nothing is stored.
 */
export class NostrConnectClient extends Effect.Service<NostrConnectClient>()(
  "linkstr/NostrConnectClient",
  {
    effect: Effect.gen(function* () {
      const transport = yield* NostrTransport;
      const inspector = yield* Inspector.orNoop;

      const open = (
        draft: NostrConnectClientDraft,
        options: NostrConnectClientOptions = {},
      ): Effect.Effect<
        NostrConnectSession,
        NostrConnectRelaysUnreachable,
        Scope.Scope
      > =>
        Effect.gen(function* () {
          const clientKey = NostrSecretKey.make(generateSecretKey());
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => clientKey.fill(0)),
          );
          const clientPubkey = derivePubkey(clientKey);
          const secret = bytesToHex(randomBytes(16));
          const signer = yield* Deferred.make<
            Pubkey,
            NostrConnectRelaysUnreachable
          >();
          const pending = new Map<string, Pending>();
          let signerPubkey: Pubkey | null = null;

          const onEvent = (raw: unknown): void => {
            const event = Either.getOrNull(decodeVerifiedPlainEvent(raw));
            if (event === null || event.kind !== NOSTR_CONNECT_KIND) return;
            if (signerPubkey !== null && event.pubkey !== signerPubkey) return;
            let plaintext: string;
            try {
              plaintext = decrypt(
                event.content,
                getConversationKey(clientKey, event.pubkey),
              );
            } catch {
              return;
            }
            const reply = Option.getOrNull(decodeReply(plaintext));
            if (reply === null) return;
            if (signerPubkey === null) {
              if (reply.result !== secret) return;
              signerPubkey = event.pubkey;
              Deferred.unsafeDone(signer, Effect.succeed(event.pubkey));
              return;
            }
            const waiting = pending.get(reply.id);
            if (waiting === undefined) return;
            Deferred.unsafeDone(
              waiting,
              reply.result === undefined
                ? Effect.fail(
                    new NostrConnectSignRefused({
                      method: "sign_event",
                      reason: reply.error ?? "no result",
                    }),
                  )
                : Effect.succeed(reply.result),
            );
          };

          const ended: Array<RelayRejection> = [];
          const allEnded = () => {
            const failure = new NostrConnectRelaysUnreachable({
              failures: [...ended],
            });
            Deferred.unsafeDone(signer, Effect.fail(failure));
            for (const waiting of pending.values()) {
              Deferred.unsafeDone(waiting, Effect.fail(failure));
            }
          };
          const filter = {
            kinds: [NOSTR_CONNECT_KIND],
            "#p": [clientPubkey],
            since: (yield* nowSeconds) - SINCE_MARGIN_SECONDS,
          };
          // Ephemeral events reach only open subscriptions: the link is
          // handed out once every relay is listening.
          const ready = yield* Effect.forEach(draft.relays, (relay) =>
            Effect.gen(function* () {
              const live = yield* Deferred.make<void>();
              yield* transport
                .subscribe(relay, filter, onEvent, {
                  onEose: () => Deferred.unsafeDone(live, Effect.void),
                })
                .pipe(
                  Effect.match({
                    onFailure: (error) => error.detail,
                    onSuccess: (reason) => reason,
                  }),
                  Effect.tap((detail) =>
                    Effect.sync(() => {
                      ended.push(new RelayRejection({ relay, detail }));
                      if (ended.length === draft.relays.length) allEnded();
                    }),
                  ),
                  Effect.ensuring(Deferred.succeed(live, undefined)),
                  Effect.forkScoped,
                );
              return live;
            }),
          );
          yield* Effect.all(ready.map(Deferred.await), {
            concurrency: "unbounded",
          }).pipe(Effect.timeoutOption(SUBSCRIBE_WAIT));
          if (ended.length === draft.relays.length) {
            return yield* new NostrConnectRelaysUnreachable({
              failures: ended,
            });
          }

          const connected = Deferred.await(signer).pipe(
            Effect.timeoutFail({
              duration: options.connectTimeout ?? CONNECT_TIMEOUT,
              onTimeout: () =>
                new NostrConnectSignerTimedOut({ waitingFor: "connect" }),
            }),
          );

          const request = (
            remote: Pubkey,
            method: string,
            params: ReadonlyArray<string>,
          ): Effect.Effect<string, NostrConnectSignError> => {
            const id = bytesToHex(randomBytes(16));
            return Effect.gen(function* () {
              const reply = yield* Deferred.make<
                string,
                NostrConnectSignRefused | NostrConnectRelaysUnreachable
              >();
              pending.set(id, reply);
              const event = signPlainEvent(
                {
                  kind: NOSTR_CONNECT_KIND,
                  tags: [["p", remote]],
                  content: encrypt(
                    JSON.stringify({ id, method, params }),
                    getConversationKey(clientKey, remote),
                  ),
                },
                yield* nowSeconds,
                clientKey,
              );
              const results = yield* transport.publish(draft.relays, event);
              if (!results.some((result) => result.accepted)) {
                return yield* new NostrConnectRequestNotDelivered({ results });
              }
              return yield* Deferred.await(reply).pipe(
                Effect.timeoutFail({
                  duration: options.replyTimeout ?? REPLY_TIMEOUT,
                  onTimeout: () =>
                    new NostrConnectSignerTimedOut({ waitingFor: "reply" }),
                }),
              );
            }).pipe(Effect.ensuring(Effect.sync(() => pending.delete(id))));
          };

          const signEvent = (
            template: PlainEventTemplate,
          ): Effect.Effect<SignedPlainEvent, NostrConnectSignError> =>
            Effect.gen(function* () {
              const remote = yield* connected;
              const createdAt = yield* nowSeconds;
              const result = yield* request(remote, "sign_event", [
                JSON.stringify({ ...template, created_at: createdAt }),
              ]);
              const signed = Option.getOrNull(decodeSignedEvent(result));
              const verified =
                signed === null
                  ? null
                  : Either.getOrNull(decodeVerifiedPlainEvent(signed));
              if (verified === null || !isSameTemplate(verified, template)) {
                return yield* new NostrConnectSignRefused({
                  method: "sign_event",
                  reason: "the signer returned a different event",
                });
              }
              return { result: verified, eventIds: [verified.id] };
            }).pipe(
              inspectPlainOperation(inspector, "nostrConnectClient.signEvent", {
                clientPubkey,
                kind: template.kind,
              }),
            );

          return {
            uri: encodeNostrConnectUri(clientPubkey, secret, draft),
            clientPubkey,
            connected,
            signEvent,
          };
        });

      return { open } as const;
    }),
  },
) {}
