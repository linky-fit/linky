import {
  ContactId,
  createId,
  directConversationIdFor,
  type ContactsRepository,
  type ConversationsRepository,
  type UnknownSendersRepository,
} from "@linky-fit/linksync";
import type { Pubkey } from "@linky-fit/linkstr";
import { Effect } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";
import { reportAppLog } from "../../../devtools/inspector/appLog";
import { trimString } from "../../../utils/validation";
import { readUnknownContactIdPubkey } from "../../hooks/messages/contactIdentity";
import {
  contactIdByConversationId,
  toLocalNostrMessage,
  toMessageWriteRow,
} from "../../hooks/messages/messageRows";
import {
  buildIdentityChangeMessageContent,
  buildIdentityChangeMessageWrapId,
  isIdentityChangeMessageContent,
  type IdentityChangeMessageSource,
} from "../../lib/identityChangeMessage";
import { sessionAtom, sessionSecrets } from "../session/session";
import {
  contactsRepositoryAtom,
  conversationsRepositoryAtom,
  SessionSignedOut,
  unknownSendersRepositoryAtom,
} from "../session/store";

export interface IdentityChange {
  readonly changedAtSec: number;
  readonly identitySource: IdentityChangeMessageSource;
}

export interface MessagesCommands {
  /** Moves a contact's or an unknown sender's messages to another contact; resolves with how many moved. */
  readonly reassignContactMessages: (
    fromContactId: string,
    toContactId: string,
  ) => Promise<number>;
  /**
   * Adds a local-only identity change notice to every contact conversation
   * that has a message. Never rejects and gives up after a bounded time, so
   * the identity switch that awaits it always reloads.
   */
  readonly appendIdentityChangeNotices: (
    change: IdentityChange,
  ) => Promise<void>;
}

// A failing Evolu database can leave its reads pending forever.
const IDENTITY_CHANGE_NOTICES_TIMEOUT = "2 seconds";

const parseContactId = (value: string): ContactId | null => {
  const result = ContactId.fromUnknown(value);
  return result.ok ? result.value : null;
};

const warnOnFailure = <A, E>(what: string, write: Effect.Effect<A, E>) =>
  write.pipe(
    Effect.asVoid,
    Effect.catch((error) =>
      Effect.sync(() =>
        console.warn(`[linky][messages] ${what} write failed`, error),
      ),
    ),
  );

const makeMessagesCommands = ({
  contacts,
  conversations,
  unknownSenders,
}: {
  readonly contacts: ContactsRepository;
  readonly conversations: ConversationsRepository;
  readonly unknownSenders: UnknownSendersRepository;
}): MessagesCommands => {
  const moveUnknownSender = (peerPubkey: Pubkey, target: ContactId) =>
    unknownSenders.moveToContact(peerPubkey, target).pipe(
      Effect.tap((moved) =>
        Effect.sync(() => {
          if (moved === 0) return;
          reportAppLog({
            tag: "unknownSenders.movedToContact",
            summary: `Moved ${moved} messages of an unknown sender to their contact`,
            links: {
              pubkey: peerPubkey,
              contact: target,
              conversation: directConversationIdFor(target),
            },
            payload: { moved },
          });
        }),
      ),
      Effect.catch((error) =>
        Effect.sync(() => {
          console.warn(
            "[linky][messages] unknown sender move write failed",
            error,
          );
          return 0;
        }),
      ),
    );

  const moveContactMessages = (from: string, target: ContactId) =>
    Effect.gen(function* () {
      const fromId = parseContactId(from);
      const [rows, conversationRows] = yield* Effect.all([
        conversations.messages.all,
        conversations.all,
      ]);
      const contactByConversation = contactIdByConversationId(
        conversationRows,
        fromId ? [{ id: fromId }] : [],
      );
      const moving = rows.filter(
        (row) =>
          row.conversationId !== null &&
          contactByConversation.get(row.conversationId) === from,
      );
      if (moving.length === 0) return 0;
      const conversationId = directConversationIdFor(target);
      yield* warnOnFailure("message move", conversations.ensureDirect(target));
      for (const row of moving)
        yield* warnOnFailure(
          "message move",
          conversations.messages.update(row.id, { conversationId }),
        );
      return moving.length;
    });

  // One move at a time, so a repeated move reads what the previous one wrote.
  let moves: Promise<void> = Promise.resolve();
  const reassignContactMessages: MessagesCommands["reassignContactMessages"] = (
    fromContactId,
    toContactId,
  ) => {
    const from = trimString(fromContactId);
    const target = parseContactId(trimString(toContactId));
    if (!from || !target || from === target) return Promise.resolve(0);
    const unknownPubkey = readUnknownContactIdPubkey(from);
    const move = moves.then(() =>
      Effect.runPromise(
        unknownPubkey
          ? moveUnknownSender(unknownPubkey, target)
          : moveContactMessages(from, target),
      ),
    );
    moves = move.then(
      () => {},
      () => {},
    );
    return move;
  };

  const appendIdentityChangeNotices: MessagesCommands["appendIdentityChangeNotices"] =
    ({ changedAtSec, identitySource }) => {
      if (!Number.isFinite(changedAtSec) || changedAtSec <= 0)
        return Promise.resolve();
      return Effect.runPromise(
        Effect.gen(function* () {
          const [rows, conversationRows, contactRows] = yield* Effect.all([
            conversations.messages.all,
            conversations.all,
            contacts.all,
          ]);
          const contactByConversation = contactIdByConversationId(
            conversationRows,
            contactRows,
          );
          const storedWrapIds = new Set<string>();
          const contactIds = new Set<string>();
          for (const row of rows) {
            storedWrapIds.add(trimString(row.wrapId));
            const contactId =
              row.conversationId === null
                ? undefined
                : contactByConversation.get(row.conversationId);
            const message = toLocalNostrMessage(row, contactId);
            if (!message || isIdentityChangeMessageContent(message.content))
              continue;
            contactIds.add(message.contactId);
          }
          const content = buildIdentityChangeMessageContent({
            changedAtSec,
            source: identitySource,
          });
          for (const contactIdText of contactIds) {
            const contactId = parseContactId(contactIdText);
            if (!contactId) continue;
            const wrapId = buildIdentityChangeMessageWrapId({
              changedAtSec,
              contactId,
              source: identitySource,
            });
            if (storedWrapIds.has(wrapId)) continue;
            const row = toMessageWriteRow(
              createId<"Message">(),
              directConversationIdFor(contactId),
              {
                contactId,
                content,
                createdAtSec: Math.trunc(changedAtSec),
                direction: "out",
                localOnly: true,
                pubkey: "",
                rumorId: null,
                wrapId,
              },
              wrapId,
            );
            if (!row) continue;
            yield* warnOnFailure(
              "message",
              Effect.flatMap(conversations.ensureDirect(contactId), () =>
                conversations.messages.insertIfAbsent(row),
              ),
            );
          }
        }).pipe(
          Effect.timeout(IDENTITY_CHANGE_NOTICES_TIMEOUT),
          Effect.catchCause((cause) =>
            Effect.sync(() =>
              console.warn(
                "[linky][messages] identity change notices failed",
                cause,
              ),
            ),
          ),
        ),
      );
    };

  return { appendIdentityChangeNotices, reassignContactMessages };
};

/**
 * Message writes over the session's conversations. Signed out it fails
 * before reading the store, so the once-per-page database atom is first
 * computed for a signed-in session.
 */
export const messagesCommandsAtom = Atom.readable((get) =>
  sessionSecrets(get(sessionAtom)) === null
    ? AsyncResult.fail(new SessionSignedOut())
    : AsyncResult.map(
        AsyncResult.all({
          contacts: get(contactsRepositoryAtom),
          conversations: get(conversationsRepositoryAtom),
          unknownSenders: get(unknownSendersRepositoryAtom),
        }),
        makeMessagesCommands,
      ),
);
