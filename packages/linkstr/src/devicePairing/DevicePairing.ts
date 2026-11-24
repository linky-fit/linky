import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js";
import { Context, Effect, Fiber, Layer, Option, Result, Schema } from "effect";
import { generateSecretKey } from "nostr-tools";
import { decrypt, encrypt, getConversationKey } from "nostr-tools/nip44";
import type { RelayUrl } from "../domain/primitives";
import { NostrSecretKey, UnixSeconds } from "../domain/primitives";
import { derivePubkey } from "../identity/codec";
import type { SignedPlainEvent } from "../internal/nostrEvent";
import {
  decodeVerifiedPlainEvent,
  signPlainEvent,
} from "../internal/plainEvent";
import { NostrTransport } from "../services/NostrTransport";
import {
  DEVICE_PAIRING_KIND,
  encodePairingInvite,
  pairingCode,
  pairingHelloProof,
  PairingPayload,
  ToJoiningDevice,
  ToOfferingDevice,
} from "./codec";
import type {
  PairingAbortReason,
  PairingInvite,
  PairingMessage,
} from "./codec";

/** NIP-40, for relays that store ephemeral events anyway. */
const EXPIRATION_SECONDS = 180;

export const PAIRING_INVITE_LIFETIME_MS = 120_000;
export const PAIRING_CODE_ENTRY_MS = 120_000;
export const PAIRING_CODE_ATTEMPTS = 3;
const ACK_WAIT_MS = 30_000;
const PAYLOAD_WAIT_MS = 300_000;

export type PairingOfferState =
  | {
      readonly phase: "waiting";
      /** The `payky:pair` text the QR code shows; never log it. */
      readonly invite: string;
      readonly expiresAt: number;
    }
  | { readonly phase: "expired" }
  | {
      readonly phase: "locked";
      /** `null` once the invite expired; the locked session goes on. */
      readonly invite: string | null;
      readonly expiresAt: number;
      readonly attemptsLeft: number;
      readonly mismatch: boolean;
    }
  | { readonly phase: "sending" }
  | {
      readonly phase: "done";
      readonly acked: boolean;
      /** The joining device's id when it said, so its row can be told apart. */
      readonly deviceId: string | null;
    }
  | {
      readonly phase: "failed";
      readonly reason: PairingAbortReason | "network";
    };

export type PairingJoinState =
  | { readonly phase: "connecting" }
  | { readonly phase: "code"; readonly code: string }
  | { readonly phase: "received"; readonly payload: PairingPayload }
  | {
      readonly phase: "failed";
      readonly reason: PairingAbortReason | "network" | "invalid";
    };

export interface PairingOffer {
  /** The six digits the joining device shows, spaces ignored. */
  readonly submitCode: (code: string) => void;
  readonly cancel: () => void;
}

export interface PairingJoin {
  readonly cancel: () => void;
}

const constantTimeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
};

const decodeToOffering = Schema.decodeUnknownOption(ToOfferingDevice);
const decodeToJoining = Schema.decodeUnknownOption(ToJoiningDevice);
const decodePayload = Schema.decodeUnknownOption(PairingPayload);

/**
 * Adds a device to the recovery seed (Finito's account/0001): the offering
 * device shows an invite with an ephemeral pubkey and a session secret, the
 * joining device answers over the invite's relays, the user types the code
 * the joining device shows into the offering one, and only then does the
 * payload travel, NIP-44-encrypted between two throwaway keys. Ephemeral keys
 * and the session secret live in the session only and are zeroed when it ends.
 */
export class DevicePairing extends Context.Service<DevicePairing>()(
  "linkstr/DevicePairing",
  {
    make: Effect.gen(function* () {
      const transport = yield* NostrTransport;
      const context = yield* Effect.context<never>();
      const runFork = Effect.runForkWith(context);

      /** The parts of a session the network touches. */
      const openChannel = (options: {
        readonly relays: ReadonlyArray<RelayUrl>;
        readonly onEvent: (event: SignedPlainEvent) => void;
        readonly onClose: () => void;
      }) => {
        const secretKey = NostrSecretKey.make(generateSecretKey());
        const pubkey = derivePubkey(secretKey);
        const seen = new Set<string>();
        let closed = false;
        let open = options.relays.length;
        // No `since`: the key is fresh, so nothing older is addressed to it,
        // and a clock running behind would make relays drop events.
        const fibers = options.relays.map((relay) =>
          runFork(
            transport
              .subscribe(
                relay,
                [{ kinds: [DEVICE_PAIRING_KIND], "#p": [pubkey] }],
                (raw) => {
                  if (closed) return;
                  const event = Result.getOrNull(decodeVerifiedPlainEvent(raw));
                  if (event === null || event.kind !== DEVICE_PAIRING_KIND)
                    return;
                  if (seen.has(event.id)) return;
                  seen.add(event.id);
                  options.onEvent(event);
                },
              )
              .pipe(
                Effect.ignore,
                Effect.ensuring(
                  Effect.sync(() => {
                    open -= 1;
                    if (open === 0 && !closed) options.onClose();
                  }),
                ),
              ),
          ),
        );

        const send = (
          to: string,
          message: PairingMessage,
        ): Promise<boolean> => {
          if (closed) return Promise.resolve(false);
          const now = UnixSeconds.make(Math.floor(Date.now() / 1000));
          const event = signPlainEvent(
            {
              kind: DEVICE_PAIRING_KIND,
              tags: [
                ["p", to],
                ["expiration", String(now + EXPIRATION_SECONDS)],
              ],
              content: encrypt(
                JSON.stringify(message),
                getConversationKey(secretKey, to),
              ),
            },
            now,
            secretKey,
          );
          return Effect.runPromise(
            Effect.map(transport.publish(options.relays, event), (results) =>
              results.some((result) => result.accepted),
            ),
          );
        };

        /** The plaintext, or `null` when it is not encrypted to this key. */
        const read = (event: SignedPlainEvent): string | null => {
          try {
            return decrypt(
              event.content,
              getConversationKey(secretKey, event.pubkey),
            );
          } catch {
            return null;
          }
        };

        const close = () => {
          if (closed) return;
          closed = true;
          for (const fiber of fibers) runFork(Fiber.interrupt(fiber));
          secretKey.fill(0);
        };

        return { pubkey, send, read, close };
      };

      /**
       * The device with the recovery seed: shows the invite, locks onto the
       * first device whose `hello` proves it saw it, and sends `payload`
       * once the user typed that device's code. A second valid `hello`
       * before then aborts both, so a raced session cannot quietly succeed.
       */
      const offer = (options: {
        readonly payload: PairingPayload;
        /** At most two are put in the invite. */
        readonly relays: ReadonlyArray<RelayUrl>;
        readonly onState: (state: PairingOfferState) => void;
      }): PairingOffer => {
        const relays = options.relays.slice(0, 2);
        const sessionSecret = randomBytes(16);
        const timers = new Set<ReturnType<typeof setTimeout>>();
        const helloPubkeys = new Set<string>();
        let state: PairingOfferState = { phase: "expired" };
        let lockedPubkey: string | null = null;
        let lockedDeviceId: string | null = null;
        let codeConfirmed = false;
        let payloadSent = false;

        const isOver = () =>
          state.phase === "done" ||
          state.phase === "failed" ||
          state.phase === "expired";
        const emit = (next: PairingOfferState) => {
          state = next;
          options.onState(next);
        };
        const finish = (next: PairingOfferState) => {
          for (const timer of timers) clearTimeout(timer);
          channel.close();
          sessionSecret.fill(0);
          emit(next);
        };
        const after = (ms: number, callback: () => void) => {
          timers.add(setTimeout(callback, ms));
        };
        const abortAll = (
          pubkeys: Iterable<string>,
          reason: PairingAbortReason,
        ) => {
          for (const pubkey of pubkeys)
            void channel.send(pubkey, { t: "abort", reason });
        };

        const onHello = (pubkey: string, proof: string, deviceId: unknown) => {
          if (codeConfirmed || helloPubkeys.has(pubkey)) return;
          const expected = pairingHelloProof(
            sessionSecret,
            channel.pubkey,
            pubkey,
          );
          if (!constantTimeEqual(proof, expected)) return;
          helloPubkeys.add(pubkey);

          if (lockedPubkey !== null) {
            abortAll(helloPubkeys, "conflict");
            finish({ phase: "failed", reason: "conflict" });
            return;
          }

          lockedPubkey = pubkey;
          lockedDeviceId =
            typeof deviceId === "string" && deviceId.length <= 64
              ? deviceId
              : null;
          emit({
            phase: "locked",
            invite: state.phase === "waiting" ? state.invite : null,
            expiresAt: Date.now() + PAIRING_CODE_ENTRY_MS,
            attemptsLeft: PAIRING_CODE_ATTEMPTS,
            mismatch: false,
          });
          after(PAIRING_CODE_ENTRY_MS, () => {
            if (codeConfirmed || isOver()) return;
            abortAll([pubkey], "timeout");
            finish({ phase: "failed", reason: "timeout" });
          });
          void channel.send(pubkey, { t: "ready" }).then((accepted) => {
            if (!accepted && !isOver())
              finish({ phase: "failed", reason: "network" });
          });
        };

        const channel = openChannel({
          relays,
          onEvent: (event) => {
            if (isOver()) return;
            const text = channel.read(event);
            if (text === null) return;
            const message = Option.getOrNull(decodeToOffering(text));
            if (message === null) return;
            if (message.t === "hello") {
              onHello(event.pubkey, message.proof, message.deviceId);
              return;
            }
            // Only the locked device may confirm or end the session.
            if (event.pubkey !== lockedPubkey) return;
            if (message.t === "ack") {
              // The ack proves the payload arrived, even before the relay confirmed sending it.
              if (codeConfirmed)
                finish({
                  phase: "done",
                  acked: true,
                  deviceId: lockedDeviceId,
                });
              return;
            }
            // Once the code is confirmed the payload may be on its way, so
            // the session can no longer report that nothing was sent.
            if (!codeConfirmed)
              finish({ phase: "failed", reason: message.reason });
          },
          onClose: () => {
            if (isOver()) return;
            finish(
              payloadSent
                ? { phase: "done", acked: false, deviceId: lockedDeviceId }
                : { phase: "failed", reason: "network" },
            );
          },
        });

        emit({
          phase: "waiting",
          invite: encodePairingInvite({
            pk: channel.pubkey,
            s: bytesToHex(sessionSecret),
            r: relays,
          }),
          expiresAt: Date.now() + PAIRING_INVITE_LIFETIME_MS,
        });
        after(PAIRING_INVITE_LIFETIME_MS, () => {
          if (state.phase === "waiting") finish({ phase: "expired" });
          else if (state.phase === "locked") emit({ ...state, invite: null });
        });

        return {
          submitCode: (code) => {
            if (state.phase !== "locked" || lockedPubkey === null) return;
            const target = lockedPubkey;
            const expected = pairingCode(sessionSecret, channel.pubkey, target);
            if (!constantTimeEqual(code.replace(/\s/g, ""), expected)) {
              const attemptsLeft = state.attemptsLeft - 1;
              if (attemptsLeft > 0) {
                emit({ ...state, attemptsLeft, mismatch: true });
                return;
              }
              abortAll([target], "codeMismatch");
              finish({ phase: "failed", reason: "codeMismatch" });
              return;
            }
            codeConfirmed = true;
            emit({ phase: "sending" });
            void channel
              .send(target, { t: "payload", data: options.payload })
              .then((accepted) => {
                if (isOver()) return;
                if (!accepted) {
                  finish({ phase: "failed", reason: "network" });
                  return;
                }
                payloadSent = true;
                after(ACK_WAIT_MS, () => {
                  if (!isOver())
                    finish({
                      phase: "done",
                      acked: false,
                      deviceId: lockedDeviceId,
                    });
                });
              });
          },
          cancel: () => {
            if (isOver()) return;
            if (lockedPubkey !== null && !codeConfirmed)
              abortAll([lockedPubkey], "cancelled");
            finish(
              codeConfirmed
                ? { phase: "done", acked: false, deviceId: lockedDeviceId }
                : { phase: "failed", reason: "cancelled" },
            );
          },
        };
      };

      /**
       * The new device: answers a scanned invite with a `hello`, shows the
       * code once the offering device locked onto it, and hands over the
       * payload. Anything not signed by the invite's key is dropped, and
       * nothing is read after a valid payload.
       */
      const join = (options: {
        readonly invite: PairingInvite;
        /** This device's id, so the offering device can tell its row. */
        readonly deviceId?: string;
        readonly onState: (state: PairingJoinState) => void;
      }): PairingJoin => {
        const { invite } = options;
        const sessionSecret = hexToBytes(invite.s);
        let state: PairingJoinState = { phase: "connecting" };
        const isOver = () =>
          state.phase === "received" || state.phase === "failed";
        const emit = (next: PairingJoinState) => {
          state = next;
          options.onState(next);
        };
        const finish = (next: PairingJoinState) => {
          clearTimeout(timer);
          channel.close();
          sessionSecret.fill(0);
          emit(next);
        };

        const timer = setTimeout(() => {
          if (!isOver()) finish({ phase: "failed", reason: "timeout" });
        }, PAYLOAD_WAIT_MS);

        const channel = openChannel({
          relays: invite.r,
          onEvent: (event) => {
            if (isOver() || event.pubkey !== invite.pk) return;
            const text = channel.read(event);
            if (text === null) return;
            const message = Option.getOrNull(decodeToJoining(text));
            if (message === null) return;
            if (message.t === "abort") {
              finish({ phase: "failed", reason: message.reason });
              return;
            }
            if (message.t === "ready") {
              if (state.phase !== "connecting") return;
              emit({
                phase: "code",
                code: pairingCode(sessionSecret, invite.pk, channel.pubkey),
              });
              return;
            }
            if (state.phase !== "code") return;
            const payload = Option.getOrNull(decodePayload(message.data));
            if (payload === null) {
              finish({ phase: "failed", reason: "invalid" });
              return;
            }
            // "Received", not "added": the user may still decline. Sent
            // before the channel closes and zeroes the key it signs with.
            void channel.send(invite.pk, { t: "ack" });
            finish({
              phase: "received",
              payload: {
                ...payload,
                transports: [...new Set(payload.transports)],
              },
            });
          },
          onClose: () => {
            if (!isOver()) finish({ phase: "failed", reason: "network" });
          },
        });

        emit(state);
        void channel
          .send(invite.pk, {
            t: "hello",
            proof: pairingHelloProof(sessionSecret, invite.pk, channel.pubkey),
            ...(options.deviceId === undefined
              ? {}
              : { deviceId: options.deviceId }),
          })
          .then((accepted) => {
            if (!accepted && !isOver())
              finish({ phase: "failed", reason: "network" });
          });

        return {
          cancel: () => {
            if (isOver()) return;
            void channel.send(invite.pk, { t: "abort", reason: "cancelled" });
            finish({ phase: "failed", reason: "cancelled" });
          },
        };
      };

      return { offer, join } as const;
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make);
}
