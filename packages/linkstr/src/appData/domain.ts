import { Effect, Schema } from "effect";
import { EventId, Pubkey, UnixSeconds } from "../domain/primitives";
import { NostrTags, SignedPlainEvent } from "../internal/nostrEvent";

/** The `d` tag naming one addressable NIP-78 slot of an author. */
export const AppDataIdentifier = Schema.Trimmed.check(Schema.isNonEmpty()).pipe(
  Schema.brand("AppDataIdentifier"),
);
export type AppDataIdentifier = typeof AppDataIdentifier.Type;

const isNotIdentifierTag = (tag: ReadonlyArray<string>): boolean =>
  tag[0] !== "d";

export class AppDataDraft extends Schema.Class<AppDataDraft>("AppDataDraft")({
  identifier: AppDataIdentifier,
  /** Extra tags after the `d` tag, e.g. `["p", <pubkey>]` to make it findable by `#p`. */
  tags: Schema.Array(
    Schema.Array(Schema.String).check(
      Schema.makeFilter(isNotIdentifierTag, {
        expected: "a tag other than d",
      }),
    ),
  ).pipe(
    Schema.withDecodingDefaultType(Effect.succeed([])),
    Schema.withConstructorDefault(Effect.succeed([])),
  ),
  /** Public: anyone can read it. */
  content: Schema.String,
}) {}

/** Which NIP-78 events to fetch or watch; every given field narrows. */
export class AppDataQuery extends Schema.Class<AppDataQuery>("AppDataQuery")({
  authors: Schema.optional(Schema.Array(Pubkey)),
  identifiers: Schema.optional(Schema.Array(AppDataIdentifier)),
  /** Events carrying a `p` tag naming any of these. */
  taggedPubkeys: Schema.optional(Schema.Array(Pubkey)),
  since: Schema.optional(UnixSeconds),
}) {}

/** The newest verified event of one author's slot. */
export class AppDataEvent extends Schema.Class<AppDataEvent>("AppDataEvent")({
  eventId: EventId,
  author: Pubkey,
  identifier: AppDataIdentifier,
  tags: NostrTags,
  content: Schema.String,
  createdAt: UnixSeconds,
  /** The signed event as received, for embedding or re-verifying elsewhere. */
  event: SignedPlainEvent,
}) {}
