import { startOfDaySec } from "./history";

/** `pending` until a relay took the merchant's message; `failed` when the outbox gave it up. */
export type SupportMessageStatus = "pending" | "sent" | "failed";

/** One message of the chat with Fazole support. */
export interface SupportMessage {
  readonly id: string;
  /** `in` from support, `out` from the merchant. */
  readonly direction: "in" | "out";
  readonly text: string;
  readonly createdAtSec: number;
  readonly status: SupportMessageStatus;
}

export interface SupportChat {
  /** Oldest first. */
  readonly messages: readonly SupportMessage[];
  /** Whether support wrote something the merchant has not opened the chat for. */
  readonly unread: boolean;
}

export interface SupportChatDay {
  /** Local midnight that starts the day, in seconds. */
  readonly startSec: number;
  readonly messages: readonly SupportMessage[];
}

/** Splits messages, oldest first, by the local day they were written on. */
export const supportChatDays = (
  messages: readonly SupportMessage[],
): SupportChatDay[] =>
  messages.reduce<SupportChatDay[]>((days, message) => {
    const startSec = startOfDaySec(message.createdAtSec);
    const last = days.at(-1);
    return last?.startSec === startSec
      ? [
          ...days.slice(0, -1),
          { startSec, messages: [...last.messages, message] },
        ]
      : [...days, { startSec, messages: [message] }];
  }, []);

/** Fixed Czech text for support, whatever the app's language. */
export const cashRequestMessage = (
  shopName: string | null,
  sats: number,
): string =>
  `${shopName ?? "Podnik bez názvu"} vyžaduje hotovost. Má ${sats} sats`;
