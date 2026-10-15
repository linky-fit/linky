export type IdentityChangeMessageSource = "custom" | "derived";

const IDENTITY_CHANGE_MESSAGE_PATTERN =
  /^\[\[linky:identity-change:(custom|derived):(\d+)\]\]$/;

export const buildIdentityChangeMessageContent = (args: {
  changedAtSec: number;
  source: IdentityChangeMessageSource;
}): string => {
  const changedAtSec = Math.max(1, Math.trunc(args.changedAtSec || 0));
  return `[[linky:identity-change:${args.source}:${changedAtSec}]]`;
};

export const buildIdentityChangeMessageWrapId = (args: {
  changedAtSec: number;
  contactId: string;
  source: IdentityChangeMessageSource;
}): string => {
  const changedAtSec = Math.max(1, Math.trunc(args.changedAtSec || 0));
  const contactId = args.contactId.trim();
  return `system:identity-change:${args.source}:${changedAtSec}:${contactId}`;
};

export const parseIdentityChangeMessageContent = (
  content: string,
): { changedAtSec: number; source: IdentityChangeMessageSource } | null => {
  const normalized = content.trim();
  const match = IDENTITY_CHANGE_MESSAGE_PATTERN.exec(normalized);
  if (!match) return null;

  const source = match[1] === "custom" ? "custom" : "derived";
  const changedAtSec = Number(match[2]);
  if (!Number.isFinite(changedAtSec) || changedAtSec <= 0) return null;

  return {
    changedAtSec: Math.trunc(changedAtSec),
    source,
  };
};

export const isIdentityChangeMessageContent = (content: string): boolean =>
  parseIdentityChangeMessageContent(content) !== null;
