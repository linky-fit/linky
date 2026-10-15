import { Schema } from "effect";

export const UnknownRecord = Schema.Record(Schema.String, Schema.Unknown);

export const NonBlankString = Schema.String.check(
  Schema.makeFilter((value) => value.trim() !== ""),
);

export const PositiveFiniteNumber = Schema.Finite.check(
  Schema.isGreaterThan(0),
);
