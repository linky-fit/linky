import { Context, Effect, Layer } from "effect";
import { UnixSeconds } from "../domain/primitives";
import { stringStorageSlot } from "../internal/stringStorage";
import type { StringStorage } from "../internal/stringStorage";

export interface InboxCursorStoreService {
  readonly load: Effect.Effect<UnixSeconds | null>;
  readonly save: (cursor: UnixSeconds) => Effect.Effect<void>;
}

const makeInMemory = (): InboxCursorStoreService => {
  let cursor: UnixSeconds | null = null;
  return {
    load: Effect.sync(() => cursor),
    save: (next) =>
      Effect.sync(() => {
        cursor = next;
      }),
  };
};

const makeStringStorage = (
  storage: StringStorage,
  key: string,
): InboxCursorStoreService => {
  const slot = stringStorageSlot<UnixSeconds>(storage, key, {
    decode: (raw) => {
      const value = Number(raw);
      return Number.isInteger(value) && value > 0
        ? UnixSeconds.make(value)
        : null;
    },
    encode: String,
  });
  return {
    load: Effect.sync(slot.read),
    save: (cursor) => Effect.sync(() => slot.write(cursor)),
  };
};

/** Storage port of the wrap inbox: the one persisted backfill cursor. */
export class InboxCursorStore extends Context.Tag("linkstr/InboxCursorStore")<
  InboxCursorStore,
  InboxCursorStoreService
>() {
  /** Non-durable; for tests and as the platform-agnostic default. */
  static readonly inMemory: Layer.Layer<InboxCursorStore> = Layer.sync(
    InboxCursorStore,
    makeInMemory,
  );

  /**
   * One storage key holding the cursor as a plain integer string; anything
   * unreadable loads as no cursor. Platform code supplies the storage
   * (web: `localStorage`).
   */
  static fromStringStorage(
    storage: StringStorage,
    key: string,
  ): Layer.Layer<InboxCursorStore> {
    return Layer.sync(InboxCursorStore, () => makeStringStorage(storage, key));
  }
}
