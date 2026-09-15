# Settings

`makeSettingsRepository(store)` (`src/repositories/settings.ts`): small synced key/value state in the app owner, replacing the ad hoc `ownerMeta` scopes such as the onboarding flag.

| Method                | Contract                                                     |
| --------------------- | ------------------------------------------------------------ |
| `get(key)`            | The value or `null`.                                         |
| `set(key, value)`     | Upserts the row `settingIdFor(key)`. Value up to 1000 chars. |
| `remove(key)`         | Tombstones; no-op when absent.                               |
| `subscribe(listener)` | Fires after any change to the `meta` scope.                  |

Shard pointers share the scope but have their own table; never write them through settings.
