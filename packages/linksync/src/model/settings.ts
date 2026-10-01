import { Schema, SchemaTransformation } from "effect";

const Flag = Schema.Literals(["1", "0"]).pipe(
  Schema.decodeTo(
    Schema.Boolean,
    SchemaTransformation.transform({
      decode: (flag) => flag === "1",
      encode: (on) => (on ? "1" : "0"),
    }),
  ),
);

const settingSchemas = {
  /** The contacts onboarding the user dismissed; absent while it still shows. */
  onboardingTutorial: Schema.Literal("dismissed"),
  /** The mint new payments use by default. */
  defaultMint: Schema.NonEmptyString,
  /** Whether test mints are visible; absent means the app's build default. */
  allowTestMints: Flag,
  /** Whether experimental features are shown; absent means off. */
  experimentalFeatures: Flag,
  /** The display currencies the user enabled; the app drops ones it does not know. */
  displayCurrencies: Schema.fromJsonString(Schema.Array(Schema.String)),
};

export type SettingKey = keyof typeof settingSchemas;

export type SettingValues = {
  readonly [K in SettingKey]: Schema.Schema.Type<(typeof settingSchemas)[K]>;
};

/**
 * Every synced setting and the schema between its value and the stored text.
 * Keys and encodings are synced data: add keys, never rename one or change its encoding.
 */
export const LinkySettings: {
  readonly [K in SettingKey]: Schema.Codec<
    SettingValues[K],
    Schema.Codec.Encoded<(typeof settingSchemas)[K]>
  >;
} = settingSchemas;
