import { describe, expect, it } from "vitest";
import { resolveSeenReceiptAdvance } from "./chatSeenReceipt";
import type { ConversationReadTimes } from "./chatUnread";

const times = (
  overrides: Partial<ConversationReadTimes> = {},
): ConversationReadTimes => ({
  newestAnyAtSec: 1_700_000_050,
  newestIncomingAtSec: 1_700_000_040,
  newestOutgoingAtSec: 1_700_000_050,
  ...overrides,
});

const ENABLED_AT_SEC = 1_600_000_000;

describe("resolveSeenReceiptAdvance", () => {
  it("reports the newest message time when there is unreported incoming", () => {
    expect(resolveSeenReceiptAdvance(times(), 0, ENABLED_AT_SEC)).toBe(
      1_700_000_050,
    );
  });

  it("returns null while the toggle is off", () => {
    expect(resolveSeenReceiptAdvance(times(), 0, 0)).toBeNull();
  });

  it("returns null without incoming messages", () => {
    expect(
      resolveSeenReceiptAdvance(
        times({ newestIncomingAtSec: 0 }),
        0,
        ENABLED_AT_SEC,
      ),
    ).toBeNull();
  });

  it("returns null when incoming predates the enable baseline", () => {
    expect(
      resolveSeenReceiptAdvance(times(), 0, times().newestIncomingAtSec),
    ).toBeNull();
  });

  it("returns null when everything incoming was already reported", () => {
    expect(
      resolveSeenReceiptAdvance(
        times(),
        times().newestIncomingAtSec,
        ENABLED_AT_SEC,
      ),
    ).toBeNull();
  });

  it("does not resend on outgoing-only activity", () => {
    const reported = resolveSeenReceiptAdvance(times(), 0, ENABLED_AT_SEC);
    expect(reported).not.toBeNull();
    const afterOwnMessage = times({ newestAnyAtSec: 1_700_000_060 });
    expect(
      resolveSeenReceiptAdvance(afterOwnMessage, reported ?? 0, ENABLED_AT_SEC),
    ).toBeNull();
  });
});
