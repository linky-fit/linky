import {
  createId as createEvoluId,
  createIdFromString,
  createRandomBytes,
  id,
  type Brand,
  type Id,
} from "@evolu/common";

export const ContactId = id("Contact");
export type ContactId = typeof ContactId.Output;

export const ConversationId = id("Conversation");
export type ConversationId = typeof ConversationId.Output;

export const MessageId = id("Message");
export type MessageId = typeof MessageId.Output;

export const ReactionId = id("Reaction");
export type ReactionId = typeof ReactionId.Output;

export const CashuProofId = id("CashuProof");
export type CashuProofId = typeof CashuProofId.Output;

export const CashuOperationId = id("CashuOperation");
export type CashuOperationId = typeof CashuOperationId.Output;

export const TransactionId = id("Transaction");
export type TransactionId = typeof TransactionId.Output;

export const RecurringPaymentId = id("RecurringPayment");
export type RecurringPaymentId = typeof RecurringPaymentId.Output;

export const ListingId = id("Listing");
export type ListingId = typeof ListingId.Output;

export const HiddenListingId = id("HiddenListing");
export type HiddenListingId = typeof HiddenListingId.Output;

export const PinnedListingId = id("PinnedListing");
export type PinnedListingId = typeof PinnedListingId.Output;

export const PeerListingsId = id("PeerListings");
export type PeerListingsId = typeof PeerListingsId.Output;

export const OnchainTransferId = id("OnchainTransfer");
export type OnchainTransferId = typeof OnchainTransferId.Output;

export const OnchainTransferMessageId = id("OnchainTransferMessage");
export type OnchainTransferMessageId = typeof OnchainTransferMessageId.Output;

export const DeviceId = id("Device");
export type DeviceId = typeof DeviceId.Output;

export const NostrIdentityId = id("NostrIdentity");
export type NostrIdentityId = typeof NostrIdentityId.Output;

export const ShardPointerId = id("ShardPointer");
export type ShardPointerId = typeof ShardPointerId.Output;

export const SettingId = id("Setting");
export type SettingId = typeof SettingId.Output;

/** Deterministic ids: every device that derives the same key lands on one row. */

/** The proof id hashes the secret, so a synced or restored proof never duplicates. */
export const cashuProofIdFor = (secret: string): CashuProofId =>
  createIdFromString<"CashuProof">(secret);

/** The operation id hashes linkshu's `operationKeyOf`. */
export const cashuOperationIdFor = (operationKey: string): CashuOperationId =>
  createIdFromString<"CashuOperation">(operationKey);

/** A replayed or synced on-chain transfer message lands on the row of its rumor. */
export const onchainTransferMessageIdFor = (
  rumorId: string,
): OnchainTransferMessageId =>
  createIdFromString<"OnchainTransferMessage">(
    `onchainTransferMessage/${rumorId}`,
  );

/** A direct chat has one conversation per contact, derivable without a lookup. */
export const directConversationIdFor = (contactId: ContactId): ConversationId =>
  createIdFromString<"Conversation">(`conversation/direct/${contactId}`);

/** One row mirrors the active identity; older clients wrote random ids. */
export const activeNostrIdentityId: NostrIdentityId =
  createIdFromString<"NostrIdentity">("nostrIdentity/active");

const randomBytes = createRandomBytes();

/** A fresh random id for a new row, branded by table (`createId<"Contact">()`). */
export function createId<B extends string>(): Id & Brand<B>;
// Evolu checks the brand only for a literal B, which this wrapper cannot pass on.
export function createId(): Id {
  return createEvoluId({ randomBytes });
}
