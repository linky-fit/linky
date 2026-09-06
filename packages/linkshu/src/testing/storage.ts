import { makeInMemoryKeyValueStore } from "../ports/inMemoryKeyValueStore";
import { makeInMemoryTokenStore } from "../ports/inMemoryTokenStore";
import type { KeyValueStoreService } from "../ports/KeyValueStore";
import type { TokenStoreService } from "../ports/TokenStore";

/** Ports that outlive one runtime; a second runtime over them models a restart. */
export interface Storage {
  readonly kv: KeyValueStoreService;
  readonly tokens: TokenStoreService;
}

export const freshStorage = (): Storage => ({
  kv: makeInMemoryKeyValueStore(),
  tokens: makeInMemoryTokenStore(),
});
