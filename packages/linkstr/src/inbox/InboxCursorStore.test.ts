import { Effect, Layer } from "effect";
import { UnixSeconds } from "../domain/primitives";
import { stubStorage } from "../testing";
import { InboxCursorStore } from "./InboxCursorStore";
import type { InboxCursorStoreService } from "./InboxCursorStore";

const storageKey = "test.inbox_cursor";
const cursor = UnixSeconds.make(1_756_000_000);

const buildStore = (
  layer: Layer.Layer<InboxCursorStore>,
): InboxCursorStoreService =>
  Effect.runSync(InboxCursorStore.pipe(Effect.provide(layer)));

const run = <A>(effect: Effect.Effect<A>): A => Effect.runSync(effect);

describe("InboxCursorStore.fromStringStorage", () => {
  it("persists the cursor under the given key across store rebuilds", () => {
    const storage = stubStorage();

    const store = buildStore(
      InboxCursorStore.fromStringStorage(storage, storageKey),
    );
    expect(run(store.load)).toBeNull();
    run(store.save(cursor));

    expect(storage.map.get(storageKey)).toBe(String(cursor));
    const rebuilt = buildStore(
      InboxCursorStore.fromStringStorage(storage, storageKey),
    );
    expect(run(rebuilt.load)).toBe(cursor);
  });

  it("loads an unreadable stored value as no cursor", () => {
    const storage = stubStorage();
    const store = buildStore(
      InboxCursorStore.fromStringStorage(storage, storageKey),
    );

    for (const value of ["", "not a number", "-5", "0", "1.5"]) {
      storage.map.set(storageKey, value);
      expect(run(store.load)).toBeNull();
    }
  });
});

describe("InboxCursorStore.inMemory", () => {
  it("starts empty and returns the last saved cursor", () => {
    const store = buildStore(InboxCursorStore.inMemory);
    expect(run(store.load)).toBeNull();
    run(store.save(cursor));
    expect(run(store.load)).toBe(cursor);
  });
});
