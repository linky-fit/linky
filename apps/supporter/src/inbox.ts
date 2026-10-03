import type { Pubkey, WrapInboxEvent } from "@linky-fit/linkstr";
import { logInfo, shortPubkey } from "./log";
import type { TokenMessage } from "./pipeline";

export interface InboxHandlerDeps {
  readonly handleToken: (message: TokenMessage) => Promise<void>;
  /** True when this call took the sender's one auto-reply for `day`. */
  readonly claimAutoReply: (sender: Pubkey, day: string) => boolean;
  readonly sendAutoReply: (to: Pubkey, day: string) => Promise<void>;
}

/** The UTC day a message was sent, so a replayed message never earns a second reply. */
const utcDay = (unixSeconds: number): string =>
  new Date(unixSeconds * 1000).toISOString().slice(0, 10);

/**
 * Payments go to the pipeline and other messages get one pointer to the
 * Linky contact per sender and day. Payment notices are ignored: the service
 * is always online to receive the token itself.
 */
export const createInboxHandler =
  (deps: InboxHandlerDeps) =>
  async (event: WrapInboxEvent): Promise<void> => {
    if (event._tag !== "ChatMessageReceived" || event.editOf !== null) return;
    if (event.body._tag === "TokenBody")
      return deps.handleToken({
        from: event.from,
        rumorId: event.messageId,
        token: event.body.token,
      });
    const day = utcDay(event.sentAt);
    if (!deps.claimAutoReply(event.from, day)) return;
    logInfo(`auto-reply to=${shortPubkey(event.from)} day=${day}`);
    await deps.sendAutoReply(event.from, day);
  };
