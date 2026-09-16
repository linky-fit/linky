import { encodeNpub, parsePubkey } from "@linky/linkstr";
import { formatShortNpub } from "./formatting";
import { normalizeProfileName } from "./profileName";

export type PushNotificationTitleKind =
  | "contact"
  | "sender"
  | "recipient"
  | "fallback";

export interface PushNotificationTitle {
  kind: PushNotificationTitleKind;
  title: string;
}

interface PushNotificationTitleArgs {
  contactName?: string | null | undefined;
  senderPubkey?: string | undefined;
  recipientIdentifier?: string | undefined;
  title?: string | undefined;
}

/**
 * The title plus which input produced it. Diagnostics log the `kind` only:
 * the title itself carries a contact name or an identity label.
 */
export const describePushNotificationTitle = (
  args: PushNotificationTitleArgs,
): PushNotificationTitle => {
  const contactName = (args.contactName ?? "").trim();
  if (contactName) return { kind: "contact", title: `Linky - ${contactName}` };

  const pubkey = parsePubkey(args.senderPubkey ?? "");
  const senderLabel = pubkey ? formatShortNpub(encodeNpub(pubkey)) : "";
  if (senderLabel) return { kind: "sender", title: `Linky - ${senderLabel}` };

  const recipientLabel = formatShortNpub(
    normalizeProfileName(args.recipientIdentifier ?? ""),
  );
  return recipientLabel
    ? { kind: "recipient", title: `Linky - ${recipientLabel}` }
    : {
        kind: "fallback",
        title: normalizeProfileName(args.title ?? "") || "Linky",
      };
};

export const buildPushNotificationTitle = (
  args: PushNotificationTitleArgs,
): string => describePushNotificationTitle(args).title;
