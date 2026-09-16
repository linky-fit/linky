import { encodeNpub, parsePubkey } from "@linky/linkstr";
import { formatShortNpub } from "./formatting";
import { normalizeProfileName } from "./profileName";

export const buildPushNotificationTitle = (args: {
  contactName?: string | null | undefined;
  senderPubkey?: string | undefined;
  recipientIdentifier?: string | undefined;
  title?: string | undefined;
}): string => {
  const contactName = (args.contactName ?? "").trim();
  if (contactName) return `Linky - ${contactName}`;

  const pubkey = parsePubkey(args.senderPubkey ?? "");
  const senderLabel = pubkey ? formatShortNpub(encodeNpub(pubkey)) : "";
  if (senderLabel) return `Linky - ${senderLabel}`;

  const recipientLabel = formatShortNpub(
    normalizeProfileName(args.recipientIdentifier ?? ""),
  );
  return recipientLabel
    ? `Linky - ${recipientLabel}`
    : normalizeProfileName(args.title ?? "") || "Linky";
};
