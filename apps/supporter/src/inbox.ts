import type { Pubkey, WrapInboxEvent } from "@linky-fit/linkstr";
import { logInfo, shortPubkey } from "./log";
import type { TokenMessage } from "./pipeline";

export interface InboxHandlerDeps {
  readonly handleToken: (message: TokenMessage) => Promise<void>;
  /** True when this call took the sender's one auto-reply for `day`. */
  readonly claimAutoReply: (sender: Pubkey, day: string) => boolean;
  readonly sendAutoReply: (to: Pubkey, day: string) => Promise<void>;
  readonly nowMs?: () => number;
}

const utcDay = (nowMs: number): string =>
  new Date(nowMs).toISOString().slice(0, 10);

/**
 * Payments go to the pipeline and other messages get one pointer to the
 * Linky contact per sender and day. Payment notices are ignored: the service
 * is always online to receive the token itself.
 */
export const createInboxHandler = (deps: InboxHandlerDeps) => {
  const now = deps.nowMs ?? Date.now;
  return async (event: WrapInboxEvent): Promise<void> => {
    if (event._tag !== "ChatMessageReceived" || event.editOf !== null) return;
    if (event.body._tag === "TokenBody")
      return deps.handleToken({
        from: event.from,
        rumorId: event.messageId,
        token: event.body.token,
      });
    // The service's own day: `sentAt` is whatever the sender claims.
    const day = utcDay(now());
    if (!deps.claimAutoReply(event.from, day)) return;
    logInfo(`auto-reply to=${shortPubkey(event.from)} day=${day}`);
    await deps.sendAutoReply(event.from, day);
  };
};
