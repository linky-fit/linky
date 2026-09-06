import { Schema } from "effect";
import { getEventHash } from "nostr-tools";
import { EventId, Pubkey, UnixSeconds, WrapId } from "../domain/primitives";

// Mutable so values are structurally assignable to nostr-tools' Event type.
export const NostrTags = Schema.mutable(
  Schema.Array(Schema.mutable(Schema.Array(Schema.String))),
);
export type NostrTags = typeof NostrTags.Type;

const NostrSignature = Schema.String.pipe(Schema.pattern(/^[0-9a-f]{128}$/));

/** A signed event as it travels over the wire (here always a kind-1059 wrap). */
export class SignedWrapEvent extends Schema.Class<SignedWrapEvent>(
  "SignedWrapEvent",
)({
  id: WrapId,
  pubkey: Pubkey,
  created_at: Schema.Int,
  kind: Schema.Literal(1059),
  tags: NostrTags,
  content: Schema.NonEmptyString,
  sig: NostrSignature,
}) {}

/** A signed plain (non-gift-wrapped) event: profile, status, relay lists, … */
export class SignedPlainEvent extends Schema.Class<SignedPlainEvent>(
  "SignedPlainEvent",
)({
  id: EventId,
  pubkey: Pubkey,
  created_at: UnixSeconds,
  kind: Schema.Int,
  tags: NostrTags,
  content: Schema.String,
  sig: NostrSignature,
}) {}

/**
 * The NIP-59 seal: signed by the real sender, carried encrypted inside the
 * wrap. Its signature is the only authentication a gift-wrapped message has.
 */
export class SignedSealEvent extends Schema.Class<SignedSealEvent>(
  "SignedSealEvent",
)({
  id: Schema.String,
  pubkey: Pubkey,
  created_at: Schema.Int,
  kind: Schema.Literal(13),
  tags: NostrTags,
  content: Schema.NonEmptyString,
  sig: Schema.String,
}) {}

/**
 * The decrypted inner event. Unsigned by design (NIP-59); `id` is the hash of
 * the unsigned form and is required here because it is the reaction identity.
 */
export class Rumor extends Schema.Class<Rumor>("Rumor")({
  id: Schema.String,
  pubkey: Pubkey,
  created_at: UnixSeconds,
  kind: Schema.Int,
  tags: NostrTags,
  content: Schema.String,
}) {}

export const rumorWithHash = (fields: {
  readonly pubkey: Pubkey;
  readonly created_at: UnixSeconds;
  readonly kind: number;
  readonly tags: NostrTags;
  readonly content: string;
}): Rumor => new Rumor({ ...fields, id: getEventHash(fields) });

export const firstTagValue = (tags: NostrTags, name: string): string | null => {
  for (const tag of tags) {
    if (tag[0] === name && tag[1] !== undefined) return tag[1];
  }
  return null;
};

export const tagValues = (tags: NostrTags, name: string): Array<string> =>
  tags.flatMap((tag) =>
    tag[0] === name && tag[1] !== undefined ? [tag[1]] : [],
  );

/** First `name` tag whose value is non-blank, trimmed. */
export const firstTrimmedTagValue = (
  tags: NostrTags,
  name: string,
): string | null =>
  tagValues(tags, name)
    .map((value) => value.trim())
    .find((value) => value.length > 0) ?? null;

/** The value of the `name` tag, only when exactly one such tag exists. */
export const singleTagValue = (
  tags: NostrTags,
  name: string,
): string | null => {
  const matching = tags.filter((tag) => tag[0] === name);
  return matching.length === 1 ? (matching[0]?.[1] ?? null) : null;
};
