import type { ConversationReadTimes } from "./chatUnread";

/**
 * Cursor to report to the peer, or null when there is nothing new to report.
 * Gated on *incoming* news past both the receipts-enabled baseline and what
 * was already reported, so one receipt covers a whole incoming batch and
 * pre-enable history is never reported. The target is the newest displayed
 * message time — never wall clock — mirroring the local read cursor.
 */
export const resolveSeenReceiptAdvance = (
  times: ConversationReadTimes,
  lastSentUpToSec: number,
  enabledAtSec: number,
): number | null => {
  if (enabledAtSec <= 0) return null;
  const floor = Math.max(lastSentUpToSec, enabledAtSec);
  if (times.newestIncomingAtSec <= floor) return null;
  return Math.max(times.newestAnyAtSec, times.newestIncomingAtSec);
};
