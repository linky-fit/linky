import { expect, it } from "vitest";
import { Effect } from "effect";
import {
  Emoji,
  ReactionDraft,
  Reactions,
  RelayUrl,
  RumorId,
  runLinkstr,
} from "@linky-fit/linkstr";
import { makeIdentity, stubWrapTransport } from "@linky-fit/linkstr/testing";
import type { SignedWrapEvent } from "@linky-fit/linkstr/testing";

it("shares schema classes between the package root and testing subpath", async () => {
  const sender = makeIdentity();
  const peer = makeIdentity();
  const published: Array<SignedWrapEvent> = [];
  const receipt = await runLinkstr(
    {
      secretKey: sender.secretKey,
      readRelays: [],
      writeRelays: [RelayUrl.make("wss://relay.example.com")],
      transport: stubWrapTransport(published),
    },
    Effect.gen(function* () {
      const reactions = yield* Reactions;
      return yield* reactions.react(
        new ReactionDraft({
          to: peer.pubkey,
          target: RumorId.make("a".repeat(64)),
          targetKind: "text",
          targetAuthor: peer.pubkey,
          emoji: Emoji.make("👍"),
        }),
      );
    }),
  );
  expect(receipt._tag).toBe("ReactionReceipt");
  expect(published).toHaveLength(2);
  expect(receipt.recipientCopy.accepted).toBe(true);
});
