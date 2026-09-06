import { Effect, Exit } from "effect";
import { NoRelayReachable } from "../domain/errors";
import { ClientId, RelayUrl, UnixSeconds } from "../domain/primitives";
import type { NostrTransportService } from "../services/NostrTransport";
import {
  makeIdentity,
  recipientOf,
  stubWrapTransportService,
} from "../testing";
import type { SignedWrapEvent } from "./nostrEvent";
import { rumorWithHash } from "./nostrEvent";
import { deliverRumorToPeer } from "./wrapDelivery";

const alice = makeIdentity();
const bob = makeIdentity();
const relay = RelayUrl.make("wss://relay.test");
const clientId = ClientId.make("client-42");
const sentAt = UnixSeconds.make(1_700_000_000);

const rumor = rumorWithHash({
  pubkey: alice.pubkey,
  created_at: sentAt,
  kind: 14,
  tags: [
    ["p", bob.pubkey],
    ["p", alice.pubkey],
    ["client", clientId],
  ],
  content: "hello",
});

/** Records the recipient of every published wrap, in publish order. */
const stubTransport = (
  publishedRecipients: Array<string | null>,
  acceptFor: (recipient: string | null) => boolean,
): NostrTransportService => {
  const published: Array<SignedWrapEvent> = [];
  return stubWrapTransportService(published, (wrap) => {
    publishedRecipients.push(recipientOf(wrap));
    return acceptFor(recipientOf(wrap));
  });
};

const deliver = (
  transport: NostrTransportService,
  order?: "parallel" | "recipientFirst",
) =>
  Effect.runPromiseExit(
    deliverRumorToPeer(
      {
        identity: alice,
        transport,
        relayPolicy: { readRelays: [relay], writeRelays: [relay] },
      },
      {
        rumor,
        peer: bob.pubkey,
        clientId,
        sentAt,
        ...(order === undefined ? {} : { order }),
      },
    ),
  );

describe("deliverRumorToPeer with order recipientFirst", () => {
  it("publishes the recipient copy before the self copy", async () => {
    const publishedRecipients: Array<string | null> = [];
    const exit = await deliver(
      stubTransport(publishedRecipients, () => true),
      "recipientFirst",
    );

    expect(publishedRecipients).toEqual([bob.pubkey, alice.pubkey]);
    assert(Exit.isSuccess(exit));
    expect(exit.value.recipientCopy.accepted).toBe(true);
    expect(exit.value.selfCopy.accepted).toBe(true);
  });

  it("never publishes the self copy when the recipient copy is rejected", async () => {
    const publishedRecipients: Array<string | null> = [];
    const exit = await deliver(
      stubTransport(publishedRecipients, () => false),
      "recipientFirst",
    );

    expect(publishedRecipients).toEqual([bob.pubkey]);
    assert(Exit.isFailure(exit) && exit.cause._tag === "Fail");
    const failure = exit.cause.error;
    expect(failure).toBeInstanceOf(NoRelayReachable);
    expect(failure.selfCopy.acceptedBy).toEqual([]);
    expect(failure.selfCopy.rejectedBy).toEqual([]);
    expect(failure.recipientCopy.accepted).toBe(false);
  });

  it("still succeeds when only the best-effort self copy is rejected", async () => {
    const publishedRecipients: Array<string | null> = [];
    const exit = await deliver(
      stubTransport(
        publishedRecipients,
        (recipient) => recipient === bob.pubkey,
      ),
      "recipientFirst",
    );

    expect(publishedRecipients).toEqual([bob.pubkey, alice.pubkey]);
    assert(Exit.isSuccess(exit));
    expect(exit.value.recipientCopy.accepted).toBe(true);
    expect(exit.value.selfCopy.accepted).toBe(false);
  });
});

describe("deliverRumorToPeer default order", () => {
  it("publishes both copies without sequencing", async () => {
    const publishedRecipients: Array<string | null> = [];
    const exit = await deliver(stubTransport(publishedRecipients, () => true));

    expect(publishedRecipients).toHaveLength(2);
    expect(publishedRecipients).toContain(bob.pubkey);
    expect(publishedRecipients).toContain(alice.pubkey);
    assert(Exit.isSuccess(exit));
  });

  it("fails with RecipientNotReached when only the self copy lands", async () => {
    const exit = await deliver(
      stubTransport([], (recipient) => recipient === alice.pubkey),
    );

    expect(exit).toEqual(
      Exit.fail(
        expect.objectContaining({
          _tag: "RecipientNotReached",
          rumorId: rumor.id,
          clientId,
          sentAt,
          selfCopy: expect.objectContaining({ acceptedBy: [relay] }),
          recipientCopy: expect.objectContaining({
            acceptedBy: [],
            rejectedBy: [expect.objectContaining({ relay, detail: "blocked" })],
          }),
        }),
      ),
    );
  });

  it("fails with NoRelayReachable when nothing lands", async () => {
    const exit = await deliver(stubTransport([], () => false));

    expect(exit).toEqual(
      Exit.fail(
        expect.objectContaining({
          _tag: "NoRelayReachable",
          rumorId: rumor.id,
          clientId,
          selfCopy: expect.objectContaining({ acceptedBy: [] }),
          recipientCopy: expect.objectContaining({ acceptedBy: [] }),
        }),
      ),
    );
  });
});
