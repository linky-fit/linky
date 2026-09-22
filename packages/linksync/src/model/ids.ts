import {
  createIdFromString,
  type MessageId,
  type ReactionId,
  type SettingId,
} from "@linky-fit/domain";
import type { Pubkey, RumorId } from "@linky-fit/linkstr";
import type { SettingKey } from "./settings";

export * from "@linky-fit/domain";

/** A message from Nostr is one row on every device, whichever conversation holds it. */
export const nostrMessageIdFor = (rumorId: RumorId): MessageId =>
  createIdFromString<"Message">(`message/nostr/${rumorId}`);

/**
 * A reaction from Nostr is one row on every device. The reactor is part of
 * the id, so a retraction stored before its reaction can only remove a
 * reaction of whoever retracted it.
 */
export const nostrReactionIdFor = (
  rumorId: RumorId,
  reactor: Pubkey,
): ReactionId =>
  createIdFromString<"Reaction">(`reaction/nostr/${reactor}/${rumorId}`);

export const settingIdFor = (key: SettingKey): SettingId =>
  createIdFromString<"Setting">(`setting/${key}`);

/** Each Nostr identity's inbox cursor is one setting row, shared by every device. */
export const inboxCursorSettingIdFor = (pubkey: Pubkey): SettingId =>
  createIdFromString<"Setting">(`setting/inboxCursor/${pubkey}`);
