import {
  KeryxFetchFailed,
  KeryxJoinUrlInvalid,
  KeryxJoinVersionUnsupported,
  KeryxLiteModeUnsupported,
} from "@linky-fit/keryx";
import { describe, expect, it } from "vitest";
import { ORIGIN, snapshot } from "../../testUtils/keryx";
import { joinErrorKey, pairErrorKey, suggestedChannels } from "./keryxPairing";

describe("keryx pairing", () => {
  it("asks for an app update on an unknown join payload version", () => {
    expect(joinErrorKey(new KeryxJoinVersionUnsupported({ version: 2 }))).toBe(
      "keryxJoinVersionUnsupported",
    );
    expect(joinErrorKey(new KeryxJoinUrlInvalid({ reason: "x" }))).toBe(
      "keryxJoinUrlInvalid",
    );
  });

  it("names lite mode apart from other pairing failures", () => {
    expect(pairErrorKey(new KeryxLiteModeUnsupported())).toBe(
      "keryxLiteModeUnsupported",
    );
    expect(
      pairErrorKey(new KeryxFetchFailed({ url: ORIGIN, reason: "x" })),
    ).toBe("keryxPairFailed");
  });

  it("preselects only suggested channels the company publishes", () => {
    expect([
      ...suggestedChannels(
        { origin: ORIGIN, channels: ["news", "marketing"], privateFeeds: [] },
        snapshot(),
      ),
    ]).toEqual(["news"]);
  });
});
