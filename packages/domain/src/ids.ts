import {
  createId as createEvoluId,
  createIdFromString,
  createRandomBytes,
  id,
} from "@evolu/common";

export const ContactId = id("Contact");
export type ContactId = typeof ContactId.Type;

export const ConversationId = id("Conversation");
export type ConversationId = typeof ConversationId.Type;

export const MessageId = id("Message");
export type MessageId = typeof MessageId.Type;

export const ReactionId = id("Reaction");
export type ReactionId = typeof ReactionId.Type;

export const CashuProofId = id("CashuProof");
export type CashuProofId = typeof CashuProofId.Type;

export const CashuOperationId = id("CashuOperation");
export type CashuOperationId = typeof CashuOperationId.Type;

export const TransactionId = id("Transaction");
export type TransactionId = typeof TransactionId.Type;

export const RecurringPaymentId = id("RecurringPayment");
export type RecurringPaymentId = typeof RecurringPaymentId.Type;

export const NostrIdentityId = id("NostrIdentity");
export type NostrIdentityId = typeof NostrIdentityId.Type;

export const ShardPointerId = id("ShardPointer");
export type ShardPointerId = typeof ShardPointerId.Type;

export const SettingId = id("Setting");
export type SettingId = typeof SettingId.Type;

/** Deterministic ids: every device that derives the same key lands on one row. */

/** The proof id hashes the secret, so a synced or restored proof never duplicates. */
export const cashuProofIdFor = (secret: string): CashuProofId =>
  createIdFromString<"CashuProof">(secret);

/** The operation id hashes linkshu's `operationKeyOf`. */
export const cashuOperationIdFor = (operationKey: string): CashuOperationId =>
  createIdFromString<"CashuOperation">(operationKey);

/** A direct chat has one conversation per contact, derivable without a lookup. */
export const directConversationIdFor = (contactId: ContactId): ConversationId =>
  createIdFromString<"Conversation">(`conversation/direct/${contactId}`);

export const settingIdFor = (key: string): SettingId =>
  createIdFromString<"Setting">(`setting/${key}`);

/** One row mirrors the active identity; older clients wrote random ids. */
export const activeNostrIdentityId: NostrIdentityId =
  createIdFromString<"NostrIdentity">("nostrIdentity/active");

const randomBytes = createRandomBytes();

/** A fresh random id for a new row, branded by table (`createId<"Contact">()`). */
export const createId = <B extends string = never>() =>
  createEvoluId<B>({ randomBytes });
