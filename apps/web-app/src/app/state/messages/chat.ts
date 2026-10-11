import { Atom } from "effect/reactivity";

/** The message being replied to. */
export interface ReplyContext {
  readonly rootMessageId: string | null;
  readonly replyToContent: string | null;
  readonly replyToId: string;
}

/** The own message being edited. */
export interface EditChatContext {
  readonly messageId: string;
  readonly originalContent: string;
  readonly rumorId: string;
}

// The open conversation's composer, kept across navigation like the rest of the shell.
export const chatDraftAtom = Atom.keepAlive(Atom.make(""));
export const chatAttachmentsAtom = Atom.keepAlive(
  Atom.make<ReadonlyArray<File>>([]),
);
export const replyContextAtom = Atom.keepAlive(
  Atom.make<ReplyContext | null>(null),
);
export const editContextAtom = Atom.keepAlive(
  Atom.make<EditChatContext | null>(null),
);
/** True while a message or an edit is being sent; the composer refuses another. */
export const chatSendBusyAtom = Atom.keepAlive(Atom.make(false));
