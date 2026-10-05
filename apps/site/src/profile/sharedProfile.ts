import { Option, Schema } from "effect";
import { linkyWebAppUrl } from "../linkyWebApp";

const SharedProfile = Schema.parseJson(
  Schema.NullOr(
    Schema.Struct({
      npub: Schema.String,
      name: Schema.NullOr(Schema.String),
      picture: Schema.NullOr(Schema.String),
      about: Schema.NullOr(Schema.String),
      lightningAddress: Schema.NullOr(Schema.String),
      status: Schema.NullOr(Schema.String),
    }),
  ),
);

export type SharedProfile = NonNullable<typeof SharedProfile.Type>;

/** The profile `api/profile.ts` rendered into the page, or null when it found none. */
export const readSharedProfile = (): SharedProfile | null =>
  Option.getOrNull(
    Schema.decodeUnknownOption(SharedProfile)(
      document.getElementById("shared-profile")?.textContent ?? "",
    ),
  );

export const buildAddContactUrl = (npub: string): string =>
  `${linkyWebAppUrl}/#add/${npub}`;

export const formatShortNpub = (npub: string): string =>
  `${npub.slice(0, 10)}…${npub.slice(-4)}`;
