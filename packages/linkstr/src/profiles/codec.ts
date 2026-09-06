import { Either, Option, Schema } from "effect";
import { isUnixSeconds } from "../domain/primitives";
import type { UnixSeconds } from "../domain/primitives";
import { firstTagValue } from "../internal/nostrEvent";
import type { SignedPlainEvent } from "../internal/nostrEvent";
import { ProfileMetadata } from "./domain";
import { ProfileUpdated, StatusUpdated } from "./events";
import type { ProfileDropReason } from "./events";

export const PROFILE_KIND = 0;
export const STATUS_KIND = 30315;
export const STATUS_D_GENERAL = "general";

/** Non-string wire values are dropped, not rejected: kind-0 content in the wild is sloppy. */
const LenientString = Schema.transform(
  Schema.Unknown,
  Schema.UndefinedOr(Schema.String),
  {
    strict: true,
    decode: (value) => (typeof value === "string" ? value : undefined),
    encode: (value) => value,
  },
);

const WireProfile = Schema.Struct({
  name: Schema.optional(LenientString),
  display_name: Schema.optional(LenientString),
  displayName: Schema.optional(LenientString),
  picture: Schema.optional(LenientString),
  image: Schema.optional(LenientString),
  lud16: Schema.optional(LenientString),
  lud06: Schema.optional(LenientString),
  nip05: Schema.optional(LenientString),
  about: Schema.optional(LenientString),
});

const nonEmpty = (value: string | undefined): string | undefined =>
  value === "" ? undefined : value;

/**
 * Tolerant kind-0 content: unknown fields are ignored. Decoding lets the
 * wire's `display_name` win over the nonstandard `displayName` spelling and
 * falls back from a missing `picture` to the legacy `image`; encoding emits
 * standard names only and omits empty fields.
 */
const ProfileContent = Schema.parseJson(
  Schema.transform(WireProfile, ProfileMetadata, {
    strict: true,
    decode: (wire) => ({
      name: wire.name,
      displayName: wire.display_name ?? wire.displayName,
      picture: wire.picture ?? wire.image,
      lud16: wire.lud16,
      lud06: wire.lud06,
      nip05: wire.nip05,
      about: wire.about,
    }),
    encode: (metadata) => ({
      name: nonEmpty(metadata.name),
      display_name: nonEmpty(metadata.displayName),
      picture: nonEmpty(metadata.picture),
      lud16: nonEmpty(metadata.lud16),
      lud06: nonEmpty(metadata.lud06),
      nip05: nonEmpty(metadata.nip05),
      about: nonEmpty(metadata.about),
    }),
  }),
);

export const decodeProfileMetadata: (
  content: string,
) => Option.Option<ProfileMetadata> =
  Schema.decodeUnknownOption(ProfileContent);

export const encodeProfileContent: (metadata: ProfileMetadata) => string =
  Schema.encodeSync(ProfileContent);

export const decodeProfileEvent = (
  event: SignedPlainEvent,
): Either.Either<ProfileUpdated, ProfileDropReason> =>
  Option.match(decodeProfileMetadata(event.content), {
    onNone: () => Either.left("malformed-profile"),
    onSome: (metadata) =>
      Either.right(
        new ProfileUpdated({
          pubkey: event.pubkey,
          metadata,
          updatedAt: event.created_at,
        }),
      ),
  });

/** NIP-40 expiration tag, tolerantly: an unparsable value means no expiry. */
const expirationOf = (event: SignedPlainEvent): UnixSeconds | null => {
  const raw = firstTagValue(event.tags, "expiration");
  if (raw === null) return null;
  const parsed = Number.parseInt(raw, 10);
  return isUnixSeconds(parsed) ? parsed : null;
};

export const decodeStatusEvent = (
  event: SignedPlainEvent,
  now: UnixSeconds,
): Either.Either<StatusUpdated, ProfileDropReason> => {
  if (firstTagValue(event.tags, "d") !== STATUS_D_GENERAL) {
    return Either.left("other-d-tag");
  }
  const expiresAt = expirationOf(event);
  if (expiresAt !== null && expiresAt <= now) return Either.left("expired");
  return Either.right(
    new StatusUpdated({
      pubkey: event.pubkey,
      content: event.content,
      expiresAt,
      updatedAt: event.created_at,
    }),
  );
};
