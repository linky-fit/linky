# Identity

`makeIdentityRepository(store)` (`src/repositories/identity.ts`) mirrors the active Nostr key in the `identity` scope (one fixed shard, never forgotten) so another device can adopt it.

| Method                                          | Contract                                             |
| ----------------------------------------------- | ---------------------------------------------------- |
| `current`                                       | The newest identity row or `null`.                   |
| `set({ nsec, npub?, source?, switchedAtSec? })` | Upserts the one row with id `activeNostrIdentityId`. |
| `subscribe(listener)`                           | Fires after any change.                              |

`source` is `derived` or `custom`; `switchedAtSec` is the cutoff after which older incoming events are ignored following a custom override. The row carries the `nsec`; keep it out of logs.
