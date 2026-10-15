import { useAtomValue } from "@linky-fit/linkstr-react";
import { Atom } from "effect/reactivity";

/**
 * The open conversation's scroll elements and flags, shared by the screen
 * that renders them and the effects that scroll them.
 */
export interface ChatScroll {
  readonly chatMessagesRef: { current: HTMLDivElement | null };
  readonly chatMessageElByIdRef: { current: Map<string, HTMLDivElement> };
  readonly chatDidInitialScrollForContactRef: { current: string | null };
  readonly chatForceScrollToBottomRef: { current: boolean };
  readonly chatScrollTargetIdRef: { current: string | null };
  readonly chatLastMessageCountRef: { current: Record<string, number> };
  /** Scrolls to the message, or to the bottom, retrying while the list renders. */
  readonly triggerChatScrollToBottom: (messageId?: string) => void;
}

const makeChatScroll = (): ChatScroll => {
  const chatMessagesRef: ChatScroll["chatMessagesRef"] = { current: null };
  const chatMessageElByIdRef: ChatScroll["chatMessageElByIdRef"] = {
    current: new Map(),
  };
  const chatForceScrollToBottomRef: ChatScroll["chatForceScrollToBottomRef"] = {
    current: false,
  };
  const chatScrollTargetIdRef: ChatScroll["chatScrollTargetIdRef"] = {
    current: null,
  };

  const triggerChatScrollToBottom = (messageId?: string) => {
    chatForceScrollToBottomRef.current = true;
    if (messageId) chatScrollTargetIdRef.current = messageId;

    const tryScroll = (attempt: number) => {
      const targetId = chatScrollTargetIdRef.current;
      if (targetId) {
        const el = chatMessageElByIdRef.current.get(targetId);
        if (el) {
          el.scrollIntoView({ block: "end" });
          return;
        }
      }

      const c = chatMessagesRef.current;
      if (c) c.scrollTop = c.scrollHeight;

      if (attempt < 6) {
        requestAnimationFrame(() => tryScroll(attempt + 1));
      }
    };

    requestAnimationFrame(() => tryScroll(0));
  };

  return {
    chatMessagesRef,
    chatMessageElByIdRef,
    chatDidInitialScrollForContactRef: { current: null },
    chatForceScrollToBottomRef,
    chatScrollTargetIdRef,
    chatLastMessageCountRef: { current: {} },
    triggerChatScrollToBottom,
  };
};

const chatScrollAtom = Atom.keepAlive(Atom.readable(makeChatScroll));

export const useChatScroll = (): ChatScroll => useAtomValue(chatScrollAtom);
