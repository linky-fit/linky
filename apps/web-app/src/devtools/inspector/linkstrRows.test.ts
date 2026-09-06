import {
  ClientId,
  Emoji,
  EventId,
  InboxRouted,
  InboxWrapDeduped,
  NoRelayReachable,
  OperationFailed,
  OperationSucceeded,
  PlainOperationSucceeded,
  ProfileEventDropped,
  ProfileMetadata,
  ProfileUpdated,
  ProfileWatchRouted,
  Pubkey,
  ReactionAdded,
  ReactionDraft,
  RelayPublishResult,
  RelayUrl,
  RumorId,
  UnixSeconds,
  WireEventReceived,
  WireFetched,
  WirePlainPublished,
  WirePublished,
  WrapDelivery,
  WrapDropped,
  WrapId,
} from "@linky/linkstr";
import { getPublicKey } from "nostr-tools";
import { describe, expect, it } from "vitest";
import { createSecretKey } from "../../testUtils/nostrKeys";
import { linkstrEventToRow } from "./linkstrRows";

const pubkey = Pubkey.make(getPublicKey(createSecretKey(7)));
const relay = RelayUrl.make("wss://relay.test");
const rumorId = RumorId.make("ab".repeat(32));
const clientId = ClientId.make("client-1");
const sentAt = UnixSeconds.make(1_754_000_000);
const selfWrapId = WrapId.make("11".repeat(32));
const recipientWrapId = WrapId.make("22".repeat(32));

const delivery = (wrapId: WrapId) =>
  new WrapDelivery({ wrapId, acceptedBy: [relay], rejectedBy: [] });

const draft = new ReactionDraft({
  to: pubkey,
  target: rumorId,
  targetKind: "text",
  targetAuthor: pubkey,
  emoji: Emoji.make("🔥"),
});

describe("linkstrEventToRow", () => {
  it("links a succeeded operation to both wrap copies", () => {
    const row = linkstrEventToRow(
      new OperationSucceeded({
        name: "reactions.react",
        params: draft,
        rumorId,
        clientId,
        sentAt,
        selfCopy: delivery(selfWrapId),
        recipientCopy: delivery(recipientWrapId),
      }),
      1000,
    );

    expect(row).toMatchObject({
      at: 1000,
      channel: "nostr.operation",
      tag: "reactions.react",
      links: {
        rumor: rumorId,
        client: clientId,
        wrap: [selfWrapId, recipientWrapId],
      },
    });
    expect(row.summary).toContain("react 🔥");
  });

  it("extracts links from a typed delivery error", () => {
    const row = linkstrEventToRow(
      new OperationFailed({
        name: "reactions.react",
        params: draft,
        error: new NoRelayReachable({
          rumorId,
          clientId,
          sentAt,
          selfCopy: delivery(selfWrapId),
          recipientCopy: delivery(recipientWrapId),
        }),
      }),
      1000,
    );

    expect(row.summary).toContain("failed: NoRelayReachable");
    expect(row.links).toEqual({
      rumor: rumorId,
      client: clientId,
      wrap: [selfWrapId, recipientWrapId],
    });
  });

  it("summarizes wire publishes with relay acceptance counts", () => {
    const row = linkstrEventToRow(
      new WirePublished({
        wrapId: selfWrapId,
        wrap: { id: selfWrapId },
        results: [
          new RelayPublishResult({ relay, accepted: true, detail: null }),
          new RelayPublishResult({ relay, accepted: false, detail: "nope" }),
        ],
      }),
      1000,
    );

    expect(row.channel).toBe("nostr.wire");
    expect(row.summary).toContain("1/2 relays accepted");
    expect(row.links).toEqual({ wrap: [selfWrapId] });
  });

  it("reads id and kind out of a raw received event", () => {
    const row = linkstrEventToRow(
      new WireEventReceived({
        relay,
        event: { id: selfWrapId, kind: 1059, content: "x" },
      }),
      1000,
    );

    expect(row.summary).toContain("gift wrap (1059)");
    expect(row.links).toEqual({ wrap: [selfWrapId] });
    expect(row.context).toEqual({ relay });

    const malformed = linkstrEventToRow(
      new WireEventReceived({ relay, event: "garbage" }),
      1000,
    );
    expect(malformed.summary).toBe(`event ← ${relay}`);
    expect(malformed.links).toEqual({});
    expect(malformed.context).toEqual({ relay });
  });

  it("names the routed fact and its rumor id", () => {
    const row = linkstrEventToRow(
      new InboxRouted({
        wrapId: recipientWrapId,
        rumorKind: 7,
        delivery: "live",
        event: new ReactionAdded({
          reactionId: rumorId,
          target: rumorId,
          from: pubkey,
          emoji: Emoji.make("👍"),
          sentAt,
        }),
      }),
      1000,
    );

    expect(row.summary).toContain("ReactionAdded 👍");
    expect(row.links).toEqual({ rumor: rumorId, wrap: [recipientWrapId] });
  });

  it("surfaces unknown rumor kinds by name on the drop path", () => {
    const row = linkstrEventToRow(
      new InboxRouted({
        wrapId: recipientWrapId,
        rumorKind: 14,
        delivery: "backfill",
        event: new WrapDropped({
          wrapId: recipientWrapId,
          reason: "unsupported-kind",
        }),
      }),
      1000,
    );

    expect(row.summary).toBe(
      "WrapDropped unsupported-kind (rumor chat message (14))",
    );
    expect(row.links).toEqual({ wrap: [recipientWrapId] });
  });

  it("marks cross-relay dedupes", () => {
    const row = linkstrEventToRow(
      new InboxWrapDeduped({ wrapId: selfWrapId }),
      1000,
    );
    expect(row.summary).toContain("deduped");
    expect(row.links).toEqual({ wrap: [selfWrapId] });
  });

  it("links a plain operation to its published events", () => {
    const eventId = EventId.make("33".repeat(32));
    const row = linkstrEventToRow(
      new PlainOperationSucceeded({
        name: "profiles.publishProfile",
        params: new ProfileMetadata({ name: "alice" }),
        eventIds: [eventId],
        result: null,
      }),
      1000,
    );

    expect(row).toMatchObject({
      channel: "nostr.operation",
      tag: "profiles.publishProfile",
      links: { wrap: [eventId] },
    });
  });

  it("summarizes plain publishes with kind names and acceptance counts", () => {
    const eventId = EventId.make("44".repeat(32));
    const row = linkstrEventToRow(
      new WirePlainPublished({
        eventId,
        kind: 10002,
        event: { id: eventId },
        results: [
          new RelayPublishResult({ relay, accepted: true, detail: null }),
        ],
      }),
      1000,
    );

    expect(row.channel).toBe("nostr.wire");
    expect(row.summary).toContain("relay list (10002)");
    expect(row.summary).toContain("1/1 relays accepted");
    expect(row.links).toEqual({ wrap: [eventId] });
  });

  it("links fetched events and names fetched kinds", () => {
    const eventId = EventId.make("55".repeat(32));
    const row = linkstrEventToRow(
      new WireFetched({
        relay,
        filter: { kinds: [0, 30315] },
        events: [{ id: eventId, kind: 0 }],
        detail: null,
      }),
      1000,
    );

    expect(row.summary).toContain("profile (0), status (30315)");
    expect(row.summary).toContain("1 event(s)");
    expect(row.links).toEqual({ wrap: [eventId] });
    expect(row.context).toEqual({ relay });
  });

  it("names profile watch facts and drops", () => {
    const eventId = EventId.make("66".repeat(32));
    const fact = linkstrEventToRow(
      new ProfileWatchRouted({
        eventId,
        kind: 0,
        event: new ProfileUpdated({
          pubkey,
          metadata: new ProfileMetadata({ name: "alice" }),
          updatedAt: sentAt,
        }),
      }),
      1000,
    );
    expect(fact.summary).toContain("ProfileUpdated");
    expect(fact.links).toEqual({ wrap: [eventId] });

    const dropped = linkstrEventToRow(
      new ProfileWatchRouted({
        eventId,
        kind: 0,
        event: new ProfileEventDropped({
          eventId,
          reason: "malformed-profile",
        }),
      }),
      1000,
    );
    expect(dropped.summary).toBe(
      "ProfileEventDropped malformed-profile (profile (0))",
    );
  });
});
