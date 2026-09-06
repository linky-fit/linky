import { Effect, Schema } from "effect";
import { Slip39 } from "slip39-ts";
import { MasterSecret, Slip39Passphrase, Slip39Share, toWords } from "./domain";

const EMPTY_PASSPHRASE = Slip39Passphrase.make("");

export interface CreateSlip39ShareOptions {
  readonly passphrase?: Slip39Passphrase;
  readonly title?: string;
}

export class IdentityDerivationError extends Schema.TaggedError<IdentityDerivationError>()(
  "IdentityDerivationError",
  { cause: Schema.optional(Schema.Unknown), message: Schema.String },
) {}

export const decodeUnknown = <A, I>(
  schema: Schema.Schema<A, I, never>,
  input: unknown,
  message: string,
): Effect.Effect<A, IdentityDerivationError> =>
  Schema.decodeUnknown(schema)(input).pipe(
    Effect.mapError((cause) => new IdentityDerivationError({ cause, message })),
  );

/** slip39-ts hands the recovered secret back as a plain byte array. */
const MasterSecretFromBytes = Schema.compose(Schema.Uint8Array, MasterSecret);

const normalizeSlip39Share = (rawText: string): string =>
  toWords(rawText.toLowerCase()).join(" ");

export const looksLikeSlip39Share = (rawText: string): boolean =>
  toWords(rawText).length === 20;

export const parseSlip39Share = (
  input: string,
): Effect.Effect<Slip39Share, IdentityDerivationError> => {
  const normalized = normalizeSlip39Share(input);
  return decodeUnknown(
    Slip39Share,
    normalized,
    "Invalid SLIP-39 share (expected a valid 20-word share)",
  );
};

export const recoverMasterSecretFromSlip39Share = (
  share: Slip39Share,
  passphrase: Slip39Passphrase = EMPTY_PASSPHRASE,
): Effect.Effect<MasterSecret, IdentityDerivationError> =>
  recoverMasterSecretFromSlip39Shares([share], passphrase);

export const recoverMasterSecretFromSlip39Shares = (
  shares: ReadonlyArray<Slip39Share>,
  passphrase: Slip39Passphrase = EMPTY_PASSPHRASE,
): Effect.Effect<MasterSecret, IdentityDerivationError> =>
  Effect.gen(function* () {
    if (shares.length === 0) {
      return yield* Effect.fail(
        new IdentityDerivationError({
          message:
            "Failed to recover master secret from SLIP-39 shares (no shares provided)",
        }),
      );
    }

    const recovered = yield* Effect.tryPromise({
      try: () => Slip39.recoverSecret(Array.from(shares), passphrase),
      catch: (cause) =>
        new IdentityDerivationError({
          cause,
          message: "Failed to recover master secret from SLIP-39 shares",
        }),
    });
    return yield* decodeUnknown(
      MasterSecretFromBytes,
      recovered,
      "Recovered SLIP-39 secret has invalid byte shape",
    );
  });

export const createSlip39Share = (
  options?: CreateSlip39ShareOptions,
): Effect.Effect<Slip39Share, IdentityDerivationError> =>
  Effect.tryPromise({
    try: async () => {
      const cryptoApi = globalThis.crypto;
      if (!cryptoApi) throw new Error("globalThis.crypto is unavailable");

      const entropy = new Uint8Array(16);
      cryptoApi.getRandomValues(entropy);

      const passphrase = options?.passphrase ?? EMPTY_PASSPHRASE;
      const title = (options?.title ?? "Linky").trim() || "Linky";

      const slip = await Slip39.fromArray(Array.from(entropy), {
        groupThreshold: 1,
        groups: [[1, 1, title]],
        passphrase,
        title,
      });
      const firstShare = slip.fromPath("r/0").mnemonics[0];
      if (typeof firstShare !== "string") {
        throw new Error("Generated SLIP-39 share is missing");
      }

      return Schema.decodeUnknownSync(Slip39Share)(
        normalizeSlip39Share(firstShare),
      );
    },
    catch: (cause) =>
      new IdentityDerivationError({
        cause,
        message: "Failed to create SLIP-39 share",
      }),
  });
