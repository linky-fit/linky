# Contacts

`makeContactsRepository(store)` (`src/repositories/contacts.ts`) is a plain `TableRepository` over the `contact` table in the `contacts` scope: profile fields and the user's overrides. Chat state is in [conversations](./conversations.md).

```ts
import {
  createId,
  makeContactsRepository,
  NonEmptyString1000,
} from "@linky/linksync";
import { Effect } from "effect";

const contacts = makeContactsRepository(store);
const id = createId<"Contact">();

await Effect.runPromise(
  contacts.insert({ id, name: NonEmptyString1000.orThrow("Alice") }),
);
const all = await Effect.runPromise(contacts.all);
```

| Method                | Contract                                                          |
| --------------------- | ----------------------------------------------------------------- |
| `all`                 | Every live contact, merged across shards.                         |
| `byId(id)`            | The contact or `null`.                                            |
| `insert(row)`         | `id` plus the non-nullable columns; nullable ones may be omitted. |
| `update(id, patch)`   | Copy-on-write; `RowNotFound` for an unknown id.                   |
| `remove(id)`          | Tombstone.                                                        |
| `subscribe(listener)` | Fires after any change to the scope.                              |

Column values are Evolu's branded types (`NonEmptyString1000`, `SqliteBoolean`); the package re-exports them. Contacts are never forgotten.

Dedupe by npub for unsaved Nostr peers stays in the app; the repository returns one row per id only.
