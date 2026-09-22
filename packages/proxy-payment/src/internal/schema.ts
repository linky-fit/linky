import { Schema } from "effect";

export const NonBlankString = Schema.String.pipe(
  Schema.filter((value) => value.trim() !== ""),
);

export const PositiveFiniteNumber = Schema.Finite.pipe(Schema.positive());
export const isPositiveFiniteNumber = Schema.is(PositiveFiniteNumber);

export const asNonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;
