import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";
import { Clock, Deferred, Duration, Effect, Option, Queue } from "effect";
import { RelayRejection } from "../domain/delivery";
import type { EventId, UnixSeconds } from "../domain/primitives";
import { Inspector } from "../inspector/Inspector";
import { inspectPlainOperation } from "../internal/inspectPlainOperation";
import { nowSeconds } from "../internal/time";
import { LinkstrIdentity } from "../services/LinkstrIdentity";
import { NostrTransport } from "../services/NostrTransport";
import {
  answerNostrConnectRequest,
  decodeNostrConnectRequest,
  encodeNostrConnectEvent,
  NOSTR_CONNECT_KIND,
  openNostrConnectChannel,
} from "./codec";
import type { NostrConnectRpcResponse } from "./codec";
import {
  NostrConnectAckNotDelivered,
  NostrConnectLoginReceipt,
  NostrConnectRelaysUnreachable,
  NostrConnectRequestRefused,
  NostrConnectTimedOut,
} from "./domain";
import type { NostrConnectRequest } from "./domain";

const LOGIN_TIMEOUT = Duration.seconds(60);
const IDLE_GRACE = Duration.seconds(10);
const SUBSCRIBE_WAIT = Duration.seconds(5);
const SINCE_MARGIN_SECONDS = 60;
/** Queued after the last request subscription ends, behind any request it delivered. */
const ALL_SUBSCRIPTIONS_ENDED = Symbol("allSubscriptionsEnded");

/**
 * One NIP-46 `nostrconnect://` login: Linky acts as the remote signer for a
 * single handshake, then closes every subscription. Nothing is stored.
 */
export class NostrConnect extends Effect.Service<NostrConnect>()(
  "linkstr/NostrConnect",
  {
    effect: Effect.gen(function* () {
      const identity = yield* LinkstrIdentity;
      const transport = yield* NostrTransport;
      const inspector = yield* Inspector.orNoop;

      /** Relays drop ephemeral events nobody subscribed to yet, so this waits until each REQ is live. */
      const openRequestFeed = (request: NostrConnectRequest, since: number) =>
        Effect.gen(function* () {
          const incoming = yield* Effect.acquireRelease(
            Queue.unbounded<unknown>(),
            Queue.shutdown,
          );
          const filter = {
            kinds: [NOSTR_CONNECT_KIND],
            authors: [request.clientPubkey],
            "#p": [identity.pubkey],
            since,
          };
          const ended: Array<RelayRejection> = [];
          const ready = yield* Effect.forEach(request.relays, (relay) =>
            Effect.gen(function* () {
              const live = yield* Deferred.make<void>();
              yield* transport
                .subscribe(
                  relay,
                  filter,
                  (event) => Queue.unsafeOffer(incoming, event),
                  { onEose: () => Deferred.unsafeDone(live, Effect.void) },
                )
                .pipe(
                  Effect.match({
                    onFailure: (error) => error.detail,
                    onSuccess: (reason) => reason,
                  }),
                  Effect.tap((detail) =>
                    Effect.sync(() => {
                      ended.push(new RelayRejection({ relay, detail }));
                      if (ended.length === request.relays.length) {
                        Queue.unsafeOffer(incoming, ALL_SUBSCRIPTIONS_ENDED);
                      }
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
          return { incoming, ended };
        });

      const login = (
        request: NostrConnectRequest,
      ): Effect.Effect<
        NostrConnectLoginReceipt,
        | NostrConnectAckNotDelivered
        | NostrConnectRelaysUnreachable
        | NostrConnectRequestRefused
        | NostrConnectTimedOut
      > => {
        const channel = openNostrConnectChannel(identity, request.clientPubkey);
        const published: Array<EventId> = [];
        const receipt = (signedKind: number | null) =>
          new NostrConnectLoginReceipt({
            clientPubkey: request.clientPubkey,
            signedKind,
          });

        const reply = (response: NostrConnectRpcResponse, now: UnixSeconds) =>
          Effect.gen(function* () {
            const event = encodeNostrConnectEvent(channel, response, now);
            published.push(event.id);
            const results = yield* transport.publish(request.relays, event);
            if (!results.some((result) => result.accepted)) {
              return yield* new NostrConnectAckNotDelivered({ results });
            }
          });

        return Effect.gen(function* () {
          const startedAt = yield* nowSeconds;
          let waitUntil =
            (yield* Clock.currentTimeMillis) + Duration.toMillis(LOGIN_TIMEOUT);
          let publicKeyShared = false;
          const seen = new Set<EventId>();
          const { incoming, ended } = yield* openRequestFeed(
            request,
            startedAt - SINCE_MARGIN_SECONDS,
          );
          const relaysUnreachable = () =>
            new NostrConnectRelaysUnreachable({ failures: ended });
          if (ended.length === request.relays.length) {
            return yield* relaysUnreachable();
          }
          yield* reply(
            { id: bytesToHex(randomBytes(16)), result: request.secret },
            yield* nowSeconds,
          );

          while (true) {
            const remaining = waitUntil - (yield* Clock.currentTimeMillis);
            const raw = yield* Queue.take(incoming).pipe(
              Effect.timeoutOption(Duration.millis(Math.max(0, remaining))),
            );
            if (Option.isNone(raw)) {
              if (publicKeyShared) return receipt(null);
              return yield* new NostrConnectTimedOut();
            }
            if (raw.value === ALL_SUBSCRIPTIONS_ENDED) {
              return yield* relaysUnreachable();
            }
            const decoded = decodeNostrConnectRequest(channel, raw.value);
            if (decoded === null || seen.has(decoded.eventId)) continue;
            seen.add(decoded.eventId);

            const now = yield* nowSeconds;
            const { response, outcome } = answerNostrConnectRequest(
              request,
              identity,
              decoded.rpc,
              now,
            );
            yield* reply(response, now);
            switch (outcome._tag) {
              case "Signed":
                return receipt(outcome.kind);
              case "Refused":
                return yield* new NostrConnectRequestRefused({
                  method: decoded.rpc.method,
                  reason: outcome.reason,
                });
              case "PublicKeyShared":
                publicKeyShared = true;
                break;
              case "Answered":
                break;
            }
            if (publicKeyShared) {
              waitUntil =
                (yield* Clock.currentTimeMillis) +
                Duration.toMillis(IDLE_GRACE);
            }
          }
        }).pipe(
          Effect.scoped,
          Effect.map((result) => ({ result, eventIds: published })),
          inspectPlainOperation(inspector, "nostrConnect.login", {
            clientPubkey: request.clientPubkey,
            relays: request.relays,
            perms: request.perms,
            name: request.name,
            url: request.url,
          }),
        );
      };

      return { login } as const;
    }),
  },
) {}
