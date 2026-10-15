interface MessageLinkMatch {
  displayText: string;
  end: number;
  start: number;
  trailingText: string;
  url: string;
}

const MESSAGE_LINK_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;
const SIMPLE_TRAILING_PUNCTUATION = /[.,!?;:]$/;

const trimUnbalancedClosingCharacter = (
  value: string,
  opening: string,
  closing: string,
): string => {
  let next = value;
  while (next.endsWith(closing)) {
    const openingCount = Array.from(next).filter(
      (character) => character === opening,
    ).length;
    const closingCount = Array.from(next).filter(
      (character) => character === closing,
    ).length;
    if (closingCount <= openingCount) break;
    next = next.slice(0, -1);
  }
  return next;
};

export const normalizeMessageLinkMatch = (
  rawMatch: string,
): { displayText: string; trailingText: string; url: string } | null => {
  let displayText = rawMatch;
  while (SIMPLE_TRAILING_PUNCTUATION.test(displayText)) {
    displayText = displayText.slice(0, -1);
  }
  displayText = trimUnbalancedClosingCharacter(displayText, "(", ")");
  displayText = trimUnbalancedClosingCharacter(displayText, "[", "]");
  displayText = trimUnbalancedClosingCharacter(displayText, "{", "}");

  if (!displayText) return null;

  const candidate = /^www\./i.test(displayText)
    ? `https://${displayText}`
    : displayText;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    if (!parsed.hostname.includes(".") && parsed.hostname !== "localhost") {
      return null;
    }
    return {
      displayText,
      trailingText: rawMatch.slice(displayText.length),
      url: parsed.toString(),
    };
  } catch {
    return null;
  }
};

export const extractMessageLinks = (content: string): MessageLinkMatch[] => {
  const links: MessageLinkMatch[] = [];
  for (const match of content.matchAll(MESSAGE_LINK_PATTERN)) {
    const rawMatch = match[0];
    const normalized = normalizeMessageLinkMatch(rawMatch);
    if (!normalized) continue;
    const start = match.index ?? 0;
    links.push({
      ...normalized,
      end: start + rawMatch.length,
      start,
    });
  }
  return links;
};
