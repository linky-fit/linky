import { Schema } from "effect";

export const NonBlankString = Schema.String.check(
  Schema.makeFilter((value) => value.trim() !== ""),
);

export const PositiveFiniteNumber = Schema.Finite.check(
  Schema.isGreaterThan(0),
);
export const isPositiveFiniteNumber = Schema.is(PositiveFiniteNumber);

export const asNonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;
