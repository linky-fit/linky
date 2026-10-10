import { AtomRegistry } from "./index";
import { ClientId, SeenReceiptDraft, UnixSeconds } from "@linky-fit/linkstr";
import { recipientOf, stubWrapTransport } from "@linky-fit/linkstr/testing";
import type { SignedWrapEvent } from "@linky-fit/linkstr/testing";
import { Exit } from "effect";
import { linkstrCommands } from "./commands";
import { linkstrConfigAtom } from "./config";
import { configWith, makeIdentity } from "./testing";

const alice = makeIdentity();
const carol = makeIdentity();

const draft = new SeenReceiptDraft({
  to: carol.pubkey,
  sinceSec: UnixSeconds.make(1_753_000_000),
  seenUpToSec: UnixSeconds.make(1_753_999_000),
  clientId: ClientId.make("client-42"),
});

describe("sendSeenReceipt", () => {
  it("delivers via the configured transport and returns a receipt", async () => {
    const registry = AtomRegistry.make();
    const published: Array<SignedWrapEvent> = [];
    registry.set(
      linkstrConfigAtom,
      configWith(alice, stubWrapTransport(published)),
    );

    const exit = await linkstrCommands(registry).sendSeenReceipt(draft);

    assert(Exit.isSuccess(exit));
    expect(exit.value.clientId).toBe("client-42");
    expect(exit.value.rumorId).toMatch(/^[0-9a-f]{64}$/);

    expect(published).toHaveLength(2);
    const recipients = published.map(recipientOf);
    expect(recipients).toContain(alice.pubkey);
    expect(recipients).toContain(carol.pubkey);
  });

  it("fails with LinkstrNotConfigured while logged out", async () => {
    const registry = AtomRegistry.make();

    const exit = await linkstrCommands(registry).sendSeenReceipt(draft);

    expect(exit).toEqual(
      Exit.fail(expect.objectContaining({ _tag: "LinkstrNotConfigured" })),
    );
  });
});
