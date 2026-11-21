import { KeyValueStore } from "@linky-fit/linkshu";
import { Effect } from "effect";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { openDaemonStorage } from "./storage";

describe("openDaemonStorage", () => {
  it("persists kv entries across reopens", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "operator-daemon-"));
    const dbPath = path.join(dir, "state.sqlite");
    try {
      const first = openDaemonStorage(dbPath);
      expect(first.kv.getItem("missing")).toBeNull();
      first.kv.setItem("k1", "v1");
      first.kv.setItem("k1", "v2");
      first.kv.setItem("k2", "v3");
      first.kv.removeItem("k2");
      first.close();

      const second = openDaemonStorage(dbPath);
      expect(second.kv.getItem("k1")).toBe("v2");
      expect(second.kv.getItem("k2")).toBeNull();
      second.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("supports linkshu values, escaped prefix listing, and leases", async () => {
    const storage = openDaemonStorage(":memory:");
    try {
      const run = <A>(effect: Effect.Effect<A, never, KeyValueStore>) =>
        Effect.runPromise(Effect.provide(effect, storage.linkshuKeyValueStore));

      await run(
        Effect.gen(function* () {
          const kv = yield* KeyValueStore;
          yield* kv.set("counter:a_1", "10");
          yield* kv.set("counter:ab1", "20");
          yield* kv.set("other:1", "30");

          expect(yield* kv.get("counter:a_1")).toBe("10");
          expect(yield* kv.listKeys("counter:a_")).toEqual(["counter:a_1"]);

          yield* kv.remove("counter:a_1");
          expect(yield* kv.get("counter:a_1")).toBeNull();

          const lease = yield* kv.tryAcquireLease("mint:lock", 60_000);
          expect(lease).not.toBeNull();
          expect(yield* kv.tryAcquireLease("mint:lock", 60_000)).toBeNull();

          if (lease !== null) {
            yield* kv.renewLease("mint:lock", lease, 60_000);
            expect(yield* kv.tryAcquireLease("mint:lock", 60_000)).toBeNull();
            yield* kv.releaseLease("mint:lock", lease);
          }

          const reacquired = yield* kv.tryAcquireLease("mint:lock", 60_000);
          expect(reacquired).not.toBeNull();
        }),
      );
    } finally {
      storage.close();
    }
  });
});
