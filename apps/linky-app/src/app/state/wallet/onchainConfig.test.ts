import {
  AppData,
  AppDataEvent,
  EventId,
  Pubkey,
  SignedPlainEvent,
  UnixSeconds,
} from "@linky-fit/linkstr";
import {
  ONCHAIN_CONFIG_IDENTIFIER,
  onchainConfigDraft,
} from "@linky-fit/onchain-transfer";
import { Effect, Stream } from "effect";
import { describe, expect, it, vi } from "vitest";
import { onchainConfigFixture } from "../../../testUtils/onchainTransfers";
import { watchOnchainConfig } from "./onchainConfig";

const operator = Pubkey.make("ab".repeat(32));
const configEvent = (paused: boolean, feeBasisPoints: number, at: number) => {
  const eventId = EventId.make(at.toString(16).padStart(64, "0"));
  const createdAt = UnixSeconds.make(at);
  const { content } = onchainConfigDraft(
    onchainConfigFixture({ paused, feeBasisPoints }),
  );
  const tags = [["d", ONCHAIN_CONFIG_IDENTIFIER]];
  return new AppDataEvent({
    eventId,
    author: operator,
    identifier: ONCHAIN_CONFIG_IDENTIFIER,
    tags,
    content,
    createdAt,
    event: new SignedPlainEvent({
      id: eventId,
      pubkey: operator,
      created_at: createdAt,
      kind: 30078,
      tags,
      content,
      sig: "cd".repeat(64),
    }),
  });
};

const collect = (
  initial: readonly AppDataEvent[],
  updates: readonly AppDataEvent[],
) =>
  Effect.runPromise(
    watchOnchainConfig(operator).pipe(
      Stream.runCollect,
      Effect.provideService(AppData, {
        publish: vi.fn(),
        fetch: () => Effect.succeed(initial),
        watch: () => Effect.succeed(Stream.fromIterable(updates)),
      }),
    ),
  );

describe("on-chain config subscription", () => {
  it("follows pause and fee changes without reopening the screen", async () => {
    expect(
      await collect(
        [configEvent(false, 100, 1)],
        [configEvent(true, 100, 2), configEvent(false, 200, 3)],
      ),
    ).toEqual([
      { status: "ready", config: onchainConfigFixture() },
      { status: "ready", config: onchainConfigFixture({ paused: true }) },
      {
        status: "ready",
        config: onchainConfigFixture({ feeBasisPoints: 200 }),
      },
    ]);
  });

  it("shows unavailable without a config and picks up the first publication", async () => {
    expect(await collect([], [configEvent(false, 100, 1)])).toEqual([
      { status: "unavailable" },
      { status: "ready", config: onchainConfigFixture() },
    ]);
  });
});
