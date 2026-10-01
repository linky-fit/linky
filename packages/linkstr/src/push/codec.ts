import { Result, Schema } from "effect";
import { verifyEvent } from "nostr-tools";
import { Pubkey, WrapId } from "../domain/primitives";
import {
  LINKY_PUSH_MARKER_TAG,
  LINKY_PUSH_MARKER_VALUE,
} from "../internal/giftWrap";
import { SignedWrapEvent, tagValues } from "../internal/nostrEvent";

export type PushWrapFailure =
  | "malformed-event"
  | "wrong-kind"
  | "invalid-signature"
  | "missing-push-marker"
  | "unexpected-recipient-count";

export interface PushWrap {
  readonly wrapId: WrapId;
  readonly recipient: Pubkey;
  readonly createdAt: number;
}

const PushWrapEvent = Schema.Struct({
  ...SignedWrapEvent.fields,
  kind: Schema.Int,
});

const decodeWrap = Schema.decodeUnknownResult(PushWrapEvent);
const decodePubkey = Schema.decodeUnknownResult(Pubkey);

const unique = <A>(values: ReadonlyArray<A>): Array<A> => [...new Set(values)];

const hasPushMarker = (raw: unknown): boolean =>
  typeof raw === "object" &&
  raw !== null &&
  "tags" in raw &&
  Array.isArray(raw.tags) &&
  raw.tags.some(
    (tag) =>
      Array.isArray(tag) &&
      tag[0] === LINKY_PUSH_MARKER_TAG &&
      tag[1] === LINKY_PUSH_MARKER_VALUE,
  );

/**
 * Validates the identity-free portion of a push-marked gift wrap. The push
 * server deliberately cannot decrypt the wrap; the outer signature still
 * authenticates its id, tags and ciphertext for safe routing and dedupe.
 */
export const decodePushWrap = (
  input: unknown,
): Result.Result<PushWrap, PushWrapFailure> =>
  Result.gen(function* () {
    if (!hasPushMarker(input)) {
      return yield* Result.fail<PushWrapFailure>("missing-push-marker");
    }
    const wrap = yield* decodeWrap(input).pipe(
      Result.mapError((): PushWrapFailure => "malformed-event"),
    );
    if (wrap.kind !== 1059) {
      return yield* Result.fail<PushWrapFailure>("wrong-kind");
    }
    if (!verifyEvent(wrap)) {
      return yield* Result.fail<PushWrapFailure>("invalid-signature");
    }

    const recipients = unique(
      tagValues(wrap.tags, "p").flatMap((value) =>
        Result.match(decodePubkey(value), {
          onFailure: () => [],
          onSuccess: (pubkey) => [pubkey],
        }),
      ),
    );
    const recipient = recipients[0];
    if (recipients.length !== 1 || recipient === undefined) {
      return yield* Result.fail<PushWrapFailure>("unexpected-recipient-count");
    }

    return {
      wrapId: wrap.id,
      recipient,
      createdAt: wrap.created_at,
    };
  });
