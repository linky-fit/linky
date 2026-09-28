import { ClientId, RetractionDraft, RumorId } from "@linky-fit/linkstr";
import { stubWrapTransport } from "@linky-fit/linkstr/testing";
import type { SignedWrapEvent } from "@linky-fit/linkstr/testing";
import {
  linkstrConfigAtom,
  Registry,
  retractReactionAtom,
} from "@linky-fit/linkstr-react";
import {
  configWith,
  makeIdentity,
  relayA,
  settle,
} from "@linky-fit/linkstr-react/testing";
import { Exit } from "effect";
import { expect, it } from "vitest";

it("drives a linkstr-react atom with helpers imported through @linky-fit/linkstr-react/testing", async () => {
  const alice = makeIdentity();
  const bob = makeIdentity();
  const registry = Registry.make();
  const published: Array<SignedWrapEvent> = [];
  registry.set(
    linkstrConfigAtom,
    configWith(alice, stubWrapTransport(published)),
  );

  registry.set(
    retractReactionAtom,
    new RetractionDraft({
      to: bob.pubkey,
      reactionIds: [RumorId.make("ab".repeat(32))],
      clientId: ClientId.make("client-42"),
    }),
  );
  const exit = await settle(registry, retractReactionAtom);

  expect(Exit.isSuccess(exit)).toBe(true);
  expect(published).toHaveLength(2);
  expect(registry.get(linkstrConfigAtom)?.writeRelays).toEqual([relayA]);
  registry.dispose();
});
