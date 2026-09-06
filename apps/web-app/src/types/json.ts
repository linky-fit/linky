import { Schema } from "effect";

type JsonPrimitive = boolean | number | string | null;

export interface JsonRecord {
  [key: string]: JsonValue;
}

type JsonArray = JsonValue[];

export type JsonValue = JsonArray | JsonPrimitive | JsonRecord;

export const JsonValue: Schema.Schema<JsonValue> = Schema.suspend(() =>
  Schema.Union(
    Schema.Null,
    Schema.Boolean,
    Schema.Finite,
    Schema.String,
    Schema.mutable(Schema.Array(JsonValue)),
    Schema.Record({ key: Schema.String, value: JsonValue }),
  ),
);
