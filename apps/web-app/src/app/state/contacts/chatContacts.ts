import type { ContactId } from "@linky-fit/linksync";
import { Atom } from "effect/reactivity";

/** Profile names of npubs met in messages without being contacts; null when the profile has none. */
export const unknownNamesAtom = Atom.keepAlive(
  Atom.make<Readonly<Record<string, string | null>>>({}),
);

/** An unknown sender saved as a contact, whose messages move over once the row is read back. */
export interface PendingUnknownContactAdd {
  readonly sourceContactId: string;
  readonly targetNpub: string;
}

export const pendingUnknownContactAddAtom = Atom.keepAlive(
  Atom.make<PendingUnknownContactAdd | null>(null),
);

/** Contacts just saved from a message, offered a group to join. */
export interface PendingContactsGroupAssignment {
  readonly messageId: string;
  readonly savedContactIds: ContactId[];
}

export const pendingContactsGroupAssignmentAtom = Atom.keepAlive(
  Atom.make<PendingContactsGroupAssignment | null>(null),
);
