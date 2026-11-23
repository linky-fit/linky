export interface ChatViewportAnchor {
  visibleBottom: number;
}

export const captureChatViewportAnchor = (
  messages: HTMLElement | null,
): ChatViewportAnchor | null => {
  if (!messages || messages.clientHeight <= 0) return null;

  return {
    visibleBottom: messages.scrollTop + messages.clientHeight,
  };
};

export const restoreChatViewportAnchor = (
  messages: HTMLElement | null,
  anchor: ChatViewportAnchor | null,
): void => {
  if (!messages || !anchor) return;

  const maxScrollTop = Math.max(
    0,
    messages.scrollHeight - messages.clientHeight,
  );
  messages.scrollTop = Math.min(
    maxScrollTop,
    Math.max(0, anchor.visibleBottom - messages.clientHeight),
  );
};

/** How close to the newest message still counts as reading it. */
export const CHAT_NEAR_BOTTOM_PX = 120;

export const isChatNearBottom = (messages: HTMLElement): boolean =>
  messages.scrollHeight - messages.scrollTop - messages.clientHeight <
  CHAT_NEAR_BOTTOM_PX;

/** Keeps a list that sits at its newest message there while the list or its content resizes, e.g. a pill or image finishing layout or the composer growing. */
export const pinChatToBottom = (
  messages: HTMLElement,
  content: HTMLElement,
): (() => void) => {
  let pinned = isChatNearBottom(messages);
  const updatePinned = () => {
    pinned = isChatNearBottom(messages);
  };
  const observer = new ResizeObserver(() => {
    if (pinned) messages.scrollTop = messages.scrollHeight;
  });
  observer.observe(messages);
  observer.observe(content);
  messages.addEventListener("scroll", updatePinned, { passive: true });
  return () => {
    observer.disconnect();
    messages.removeEventListener("scroll", updatePinned);
  };
};
