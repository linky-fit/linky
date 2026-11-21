import { makeSettingsRepository } from "@linky-fit/linksync";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { OperatorProfile } from "../domain/profile";
import { testStore } from "../services/testing/fakes";
import { readProfile, saveProfile } from "./profile";

const profile: OperatorProfile = {
  name: "Dave's transfers",
  xpub: "tpub-key",
  sendFeeBasisPoints: 150,
  receiveFeeBasisPoints: 50,
  paused: true,
  description: "x".repeat(1000),
  amounts: [100_000],
  maxReceiveAmount: 400_000,
  minReceiveAmount: 100_000,
  minClientVersion: "26.10.7",
  watchers: [makeIdentity().pubkey, makeIdentity().pubkey],
  picture: "https://blossom.primal.net/ab12.webp",
};

describe("profile setting", () => {
  it("reads back what was saved, a whole-column description included", async () => {
    const settings = makeSettingsRepository(testStore());
    expect(await Effect.runPromise(readProfile(settings))).toBeNull();
    await Effect.runPromise(saveProfile(settings, profile));
    expect(await Effect.runPromise(readProfile(settings))).toEqual(profile);
    const emptied = {
      ...profile,
      description: "",
      minClientVersion: null,
      watchers: [],
      picture: null,
    };
    await Effect.runPromise(saveProfile(settings, emptied));
    expect(await Effect.runPromise(readProfile(settings))).toEqual(emptied);
  });

  it("names a profile saved before the operator had a name, a picture, receive limits, a receive fee or a minimum Linky version", async () => {
    const settings = makeSettingsRepository(testStore());
    await Effect.runPromise(
      settings.setRaw(
        "onchain-operator.profile",
        JSON.stringify({
          xpub: "tpub-key",
          feeBasisPoints: 100,
          paused: false,
          amounts: [100_000],
        }),
      ),
    );
    expect(await Effect.runPromise(readProfile(settings))).toMatchObject({
      name: "Linky support",
      xpub: "tpub-key",
      sendFeeBasisPoints: 100,
      receiveFeeBasisPoints: 100,
      maxReceiveAmount: 2_000_000,
      minReceiveAmount: 100_000,
      minClientVersion: null,
      picture: null,
    });
  });
});
