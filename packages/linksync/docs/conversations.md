# Conversations

`makeConversationsRepository(store)` (`src/repositories/conversations.ts`): chats with their read cursor and archive state, plus the messages and reactions in them. All three tables live in the `messages` scope, which keeps the newest 4 shards.

```ts
import { makeConversationsRepository, PositiveInt } from "@linky/linksync";
import { Effect } from "effect";

const conversations = makeConversationsRepository(store);

const chat = await Effect.runPromise(conversations.ensureDirect(contactId));
await Effect.runPromise(
  conversations.markSeen(chat.id, PositiveInt.orThrow(nowSec)),
);
const messages = await Effect.runPromise(conversations.messagesIn(chat.id));
```

| Method                                 | Contract                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `ensureDirect(contactId)`              | The contact's direct chat, created on first use with `directConversationIdFor(contactId)`.       |
| `forContact(contactId)`                | The direct chat or `null`.                                                                       |
| `messagesIn(id)` / `reactionsIn(id)`   | Rows of one conversation, unsorted.                                                              |
| `markSeen(id, atSec)`                  | Moves `lastSeenAtSec` forward; a lower value is ignored.                                         |
| `setPeerSeen(id, { sinceSec, atSec })` | The peer's seen window from their latest read receipt.                                           |
| `archive(id, atSec)` / `unarchive(id)` | Archive is a chat action, so it lives here and not on the contact.                               |
| `messages`, `reactions`                | `TableRepository`s for direct inserts and updates (`insert`, `update`, `remove`, `all`, `byId`). |
| plus the `TableRepository` methods     | `all`, `byId`, `insert`, `update`, `remove`, `subscribe` over `conversation`.                    |

A cursor update on a conversation born in an old shard copies it forward, so an active chat travels with the user while a dead one is forgotten with its messages when its shard leaves the window. Insert messages with the `conversationId` from `ensureDirect`; the schema has no `contactId` on messages.
