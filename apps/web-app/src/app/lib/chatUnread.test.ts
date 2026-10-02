import { describe, expect, it } from "vitest";
import {
  collectUnreadNewestIncomingByContactId,
  contactsToUnarchive,
  isConversationUnread,
  resolveChatLastSeenAdvance,
  summarizeConversationReadTimes,
} from "./chatUnread";

const message = (direction: "in" | "out", createdAtSec: number) => ({
  direction,
  createdAtSec,
});

describe("summarizeConversationReadTimes", () => {
  it("tracks the newest time per direction and overall", () => {
    expect(
      summarizeConversationReadTimes([
        message("in", 10),
        message("out", 30),
        message("in", 20),
      ]),
    ).toEqual({
      newestAnyAtSec: 30,
      newestIncomingAtSec: 20,
      newestOutgoingAtSec: 30,
    });
  });

  it("ignores non-positive timestamps", () => {
    expect(
      summarizeConversationReadTimes([message("in", 0), message("out", -5)]),
    ).toEqual({
      newestAnyAtSec: 0,
      newestIncomingAtSec: 0,
      newestOutgoingAtSec: 0,
    });
  });
});

describe("isConversationUnread", () => {
  it("is read without incoming messages", () => {
    const times = summarizeConversationReadTimes([message("out", 10)]);
    expect(isConversationUnread(times, null)).toBe(false);
    expect(isConversationUnread(times, 5)).toBe(false);
  });

  it("compares the newest incoming message against a present cursor", () => {
    const times = summarizeConversationReadTimes([
      message("in", 20),
      message("out", 30),
    ]);
    expect(isConversationUnread(times, 19)).toBe(true);
    expect(isConversationUnread(times, 20)).toBe(false);
    expect(isConversationUnread(times, 25)).toBe(false);
  });

  it("falls back to the last-word rule without a cursor", () => {
    expect(
      isConversationUnread(
        summarizeConversationReadTimes([message("in", 20), message("out", 30)]),
        null,
      ),
    ).toBe(false);
    expect(
      isConversationUnread(
        summarizeConversationReadTimes([message("out", 10), message("in", 20)]),
        null,
      ),
    ).toBe(true);
    expect(
      isConversationUnread(
        summarizeConversationReadTimes([message("in", 20)]),
        null,
      ),
    ).toBe(true);
  });

  it("treats a non-positive cursor as missing", () => {
    const times = summarizeConversationReadTimes([
      message("in", 20),
      message("out", 30),
    ]);
    expect(isConversationUnread(times, 0)).toBe(false);
  });
});

describe("resolveChatLastSeenAdvance", () => {
  it("returns nothing for a read conversation", () => {
    const times = summarizeConversationReadTimes([
      message("in", 20),
      message("out", 30),
    ]);
    expect(resolveChatLastSeenAdvance(times, 25)).toBeNull();
    expect(resolveChatLastSeenAdvance(times, null)).toBeNull();
  });

  it("advances to the newest message of any direction when unread", () => {
    expect(
      resolveChatLastSeenAdvance(
        summarizeConversationReadTimes([message("out", 10), message("in", 20)]),
        10,
      ),
    ).toBe(20);
    expect(
      resolveChatLastSeenAdvance(
        summarizeConversationReadTimes([message("in", 20), message("out", 30)]),
        15,
      ),
    ).toBe(30);
    expect(
      resolveChatLastSeenAdvance(
        summarizeConversationReadTimes([message("in", 20)]),
        null,
      ),
    ).toBe(20);
  });
});

describe("collectUnreadNewestIncomingByContactId", () => {
  it("maps unread conversations to their newest incoming time", () => {
    const unread = collectUnreadNewestIncomingByContactId(
      [
        { ...message("in", 20), contactId: "a" },
        { ...message("out", 10), contactId: "a" },
        { ...message("in", 40), contactId: "b" },
        { ...message("in", 15), contactId: "c" },
        { ...message("out", 25), contactId: "c" },
      ],
      new Map([["b", 40]]),
      null,
    );

    expect(unread).toEqual(new Map([["a", 20]]));
  });

  it("uses the cursor when present even if the last word is ours", () => {
    const unread = collectUnreadNewestIncomingByContactId(
      [
        { ...message("in", 20), contactId: "a" },
        { ...message("out", 30), contactId: "a" },
      ],
      new Map([["a", 10]]),
      null,
    );

    expect(unread).toEqual(new Map([["a", 20]]));
  });

  it("counts messages up to the oldest visible shard as read", () => {
    const unread = collectUnreadNewestIncomingByContactId(
      [
        { ...message("in", 50), contactId: "forgotten" },
        { ...message("in", 50), contactId: "revived" },
        { ...message("in", 150), contactId: "revived" },
        { ...message("in", 150), contactId: "brandNew" },
      ],
      new Map(),
      100,
    );

    expect(unread).toEqual(
      new Map([
        ["revived", 150],
        ["brandNew", 150],
      ]),
    );
  });
});

describe("contactsToUnarchive", () => {
  const archived = (id: string, archivedAtSec: number | null) => ({
    id,
    archivedAtSec,
  });

  it("restores an archived contact only for unread messages newer than the archive", () => {
    const unread = collectUnreadNewestIncomingByContactId(
      [
        { ...message("in", 80), contactId: "quiet" },
        { ...message("in", 80), contactId: "writes" },
        { ...message("in", 200), contactId: "writes" },
        { ...message("in", 200), contactId: "active" },
      ],
      new Map(),
      100,
    );

    expect(
      contactsToUnarchive(
        [
          archived("quiet", 90),
          archived("writes", 150),
          archived("active", null),
        ],
        unread,
      ).map((contact) => contact.id),
    ).toEqual(["writes"]);
  });

  it("keeps a contact archived when its chat has no visible cursor and only older messages", () => {
    const unread = collectUnreadNewestIncomingByContactId(
      [{ ...message("in", 120), contactId: "old" }],
      new Map(),
      null,
    );

    expect(unread.get("old")).toBe(120);
    expect(contactsToUnarchive([archived("old", 130)], unread)).toEqual([]);
  });
});
