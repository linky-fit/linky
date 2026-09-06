import { Registry } from "./index";
import { ClientId, SeenReceiptDraft, UnixSeconds } from "@linky/linkstr";
import { recipientOf, stubWrapTransport } from "@linky/linkstr/testing";
import type { SignedWrapEvent } from "@linky/linkstr/testing";
import { Exit } from "effect";
import { linkstrConfigAtom } from "./config";
import { sendSeenReceiptAtom } from "./seenReceipts";
import { configWith, makeIdentity, settle } from "./testing";

const alice = makeIdentity();
const carol = makeIdentity();

const draft = new SeenReceiptDraft({
  to: carol.pubkey,
  sinceSec: UnixSeconds.make(1_753_000_000),
  seenUpToSec: UnixSeconds.make(1_753_999_000),
  clientId: ClientId.make("client-42"),
});

describe("sendSeenReceiptAtom", () => {
  it("delivers via the configured transport and returns a receipt", async () => {
    const registry = Registry.make();
    const published: Array<SignedWrapEvent> = [];
    registry.set(
      linkstrConfigAtom,
      configWith(alice, stubWrapTransport(published)),
    );

    registry.set(sendSeenReceiptAtom, draft);
    const exit = await settle(registry, sendSeenReceiptAtom);

    assert(Exit.isSuccess(exit));
    expect(exit.value.clientId).toBe("client-42");
    expect(exit.value.rumorId).toMatch(/^[0-9a-f]{64}$/);

    expect(published).toHaveLength(2);
    const recipients = published.map(recipientOf);
    expect(recipients).toContain(alice.pubkey);
    expect(recipients).toContain(carol.pubkey);
  });

  it("fails with LinkstrNotConfigured while logged out", async () => {
    const registry = Registry.make();

    registry.set(sendSeenReceiptAtom, draft);
    const exit = await settle(registry, sendSeenReceiptAtom);

    expect(exit).toEqual(
      Exit.fail(expect.objectContaining({ _tag: "LinkstrNotConfigured" })),
    );
  });
});
