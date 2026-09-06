import { Schema } from "effect";

export const UnknownRecord = Schema.Record({
  key: Schema.String,
  value: Schema.Unknown,
});

export const NonBlankString = Schema.String.pipe(
  Schema.filter((value) => value.trim() !== ""),
);

export const PositiveFiniteNumber = Schema.Finite.pipe(Schema.positive());
