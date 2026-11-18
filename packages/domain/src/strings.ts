import { maxLength, minLength, String } from "@evolu/common";

/**
 * Evolu 7's string column types, which Evolu 8 dropped. Their rules stay
 * exactly as Evolu 7 checked them, because Evolu 7 devices sync these columns.
 */
export const NonEmptyString = minLength(1)(String);
export type NonEmptyString = typeof NonEmptyString.Output;

export const NonEmptyString100 = maxLength(100)(NonEmptyString);
export type NonEmptyString100 = typeof NonEmptyString100.Output;

export const NonEmptyString1000 = maxLength(1000)(NonEmptyString);
export type NonEmptyString1000 = typeof NonEmptyString1000.Output;
