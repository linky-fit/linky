import { NonEmptyString100, NonEmptyString1000 } from "@linky-fit/linksync";
import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { czechAccountToIban, parseCzechAccount } from "../domain";
import { testStore } from "../services/testing/fakes";
import {
  monetaSettingId,
  parseMonetaTokenInput,
  readMonetaConnection,
  saveMonetaConnection,
} from "./monetaSetting";
import { makeSettingsRepository } from "./shop";

const parsed = parseCzechAccount("2000145399/0600");
if (Result.isFailure(parsed)) throw new Error("invalid test account");
const iban = czechAccountToIban(parsed.success);
const connection = { token: "tok-".padEnd(40, "x"), accountId: "A1", iban };

describe("the MONETA connection", () => {
  it("is absent until stored, and absent again once removed", async () => {
    const settings = makeSettingsRepository(testStore());
    expect(await Effect.runPromise(readMonetaConnection(settings))).toBeNull();
    await Effect.runPromise(saveMonetaConnection(settings, connection));
    expect(await Effect.runPromise(readMonetaConnection(settings))).toEqual(
      connection,
    );
    await Effect.runPromise(saveMonetaConnection(settings, null));
    expect(await Effect.runPromise(readMonetaConnection(settings))).toBeNull();
  });

  it("is absent when the stored row is incomplete", async () => {
    const settings = makeSettingsRepository(testStore());
    await Effect.runPromise(
      settings.insert({
        id: monetaSettingId,
        key: NonEmptyString100.orThrow("fazole.moneta"),
        value: NonEmptyString1000.orThrow(
          JSON.stringify({ token: connection.token, iban }),
        ),
      }),
    );
    expect(await Effect.runPromise(readMonetaConnection(settings))).toBeNull();
  });
});

describe("parseMonetaTokenInput", () => {
  it("trims a token and refuses what cannot be one", () => {
    expect(parseMonetaTokenInput("  abcdefgh12 \n")).toBe("abcdefgh12");
    expect(parseMonetaTokenInput("short")).toBeNull();
    expect(parseMonetaTokenInput("two words here")).toBeNull();
    expect(parseMonetaTokenInput("x".repeat(801))).toBeNull();
  });
});
