interface ConversationReadMessage {
  createdAtSec: number;
  direction: "in" | "out";
}

export interface ConversationReadTimes {
  newestAnyAtSec: number;
  newestIncomingAtSec: number;
  newestOutgoingAtSec: number;
}

const toPositiveSec = (value: number | null | undefined): number => {
  const parsed = value ?? 0;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const emptyTimes = (): ConversationReadTimes => ({
  newestAnyAtSec: 0,
  newestIncomingAtSec: 0,
  newestOutgoingAtSec: 0,
});

const addMessageToTimes = (
  times: ConversationReadTimes,
  message: ConversationReadMessage,
): void => {
  const atSec = toPositiveSec(message.createdAtSec);
  if (atSec === 0) return;
  if (atSec > times.newestAnyAtSec) times.newestAnyAtSec = atSec;
  if (message.direction === "in") {
    if (atSec > times.newestIncomingAtSec) times.newestIncomingAtSec = atSec;
  } else if (atSec > times.newestOutgoingAtSec) {
    times.newestOutgoingAtSec = atSec;
  }
};

export const summarizeConversationReadTimes = (
  messages: readonly ConversationReadMessage[],
): ConversationReadTimes => {
  const times = emptyTimes();
  for (const message of messages) addMessageToTimes(times, message);
  return times;
};

// Without a cursor (pre-upgrade or unknown contacts) a conversation counts as
// read only when the last word is ours.
export const isConversationUnread = (
  times: ConversationReadTimes,
  lastSeenAtSec: number | null,
): boolean => {
  if (times.newestIncomingAtSec === 0) return false;
  const cursor = toPositiveSec(lastSeenAtSec);
  if (cursor > 0) return times.newestIncomingAtSec > cursor;
  if (times.newestOutgoingAtSec === 0) return true;
  return times.newestIncomingAtSec > times.newestOutgoingAtSec;
};

export const resolveChatLastSeenAdvance = (
  times: ConversationReadTimes,
  lastSeenAtSec: number | null,
): number | null => {
  if (!isConversationUnread(times, lastSeenAtSec)) return null;
  const target = times.newestAnyAtSec;
  return target > toPositiveSec(lastSeenAtSec) ? target : null;
};

export const collectUnreadNewestIncomingByContactId = (
  messages: readonly (ConversationReadMessage & { contactId: string })[],
  lastSeenAtSecByContactId: ReadonlyMap<string, number>,
): Map<string, number> => {
  const timesByContactId = new Map<string, ConversationReadTimes>();
  for (const message of messages) {
    const contactId = message.contactId.trim();
    if (!contactId) continue;
    let times = timesByContactId.get(contactId);
    if (!times) {
      times = emptyTimes();
      timesByContactId.set(contactId, times);
    }
    addMessageToTimes(times, message);
  }

  const unreadByContactId = new Map<string, number>();
  for (const [contactId, times] of timesByContactId) {
    const lastSeenAtSec = lastSeenAtSecByContactId.get(contactId) ?? null;
    if (isConversationUnread(times, lastSeenAtSec)) {
      unreadByContactId.set(contactId, times.newestIncomingAtSec);
    }
  }
  return unreadByContactId;
};
