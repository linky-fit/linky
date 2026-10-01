import { Schema } from "effect";

const Flag = Schema.transform(Schema.Literal("1", "0"), Schema.Boolean, {
  strict: true,
  decode: (flag) => flag === "1",
  encode: (on) => (on ? "1" : "0"),
});

const settingSchemas = {
  /** The contacts onboarding the user dismissed; absent while it still shows. */
  onboardingTutorial: Schema.Literal("dismissed"),
  /** The mint new payments use by default. */
  defaultMint: Schema.NonEmptyString,
  /** Whether test mints are visible; absent means the app's build default. */
  allowTestMints: Flag,
  /** When the first device moved lane data to shards; the first writer wins. */
  "laneMigration.cutoffMs": Schema.NumberFromString.pipe(
    Schema.int(),
    Schema.positive(),
  ),
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
  readonly [K in SettingKey]: Schema.Schema<
    SettingValues[K],
    Schema.Schema.Encoded<(typeof settingSchemas)[K]>
  >;
} = settingSchemas;
