import {
  createConsole,
  createRandom,
  createRandomBytes,
  createTime,
  id,
  NonEmptyString,
  ok,
  SimpleName,
  type SqliteRow,
  type SqliteValue,
} from "@evolu/common";
import {
  createEvolu,
  type DbWorkerPlatformDeps,
} from "@evolu/common/local-first";
import { DatabaseSync } from "node:sqlite";
import { testAppOwner } from "../testing/toy";
import {
  createInProcessOwnerSyncDbWorker,
  type WorkerMessage,
} from "./dbWorker";
import { trackOwnerSync } from "./ownerSync";

const toSqliteRow = (row: Record<string, unknown>): SqliteRow =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]): [string, SqliteValue] => {
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        value instanceof Uint8Array
      )
        return [key, value];
      throw new Error(`Unexpected SQLite value in ${key}`);
    }),
  );

const inMemoryDeps = (database: DatabaseSync): DbWorkerPlatformDeps => ({
  console: createConsole(),
  createSqliteDriver: () =>
    Promise.resolve({
      exec: ({ sql, parameters }, isMutation) => {
        const statement = database.prepare(sql);
        if (isMutation)
          return {
            rows: [],
            changes: Number(statement.run(...parameters).changes),
          };
        return {
          rows: statement.all(...parameters).map(toSqliteRow),
          changes: 0,
        };
      },
      export: () => new Uint8Array(),
      [Symbol.dispose]: () => {},
    }),
  createWebSocket: () => ({
    send: () => ok(),
    getReadyState: () => "connecting",
    isOpen: () => false,
    [Symbol.dispose]: () => {},
  }),
  random: createRandom(),
  randomBytes: createRandomBytes(),
  time: createTime(),
});

const macrotask = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createInProcessOwnerSyncDbWorker", () => {
  it("delivers what the worker posted before the page listened, then later posts", async () => {
    const worker = createInProcessOwnerSyncDbWorker(
      inMemoryDeps(new DatabaseSync(":memory:")),
    );
    worker.postMessage({ type: "linksync.ownersSyncedRequest" });

    const received: WorkerMessage[] = [];
    worker.onMessage((message) => received.push(message));
    await macrotask();
    expect(received).toEqual([{ type: "linksync.ownersSynced", ownerIds: [] }]);

    worker.postMessage({ type: "linksync.ownersSyncedRequest" });
    await macrotask();
    expect(received).toHaveLength(2);
  });

  it("delivers the next message after a page callback throws", async () => {
    let thrown = 0;
    vi.stubGlobal("queueMicrotask", (task: () => void) => {
      void Promise.resolve()
        .then(task)
        .catch(() => {
          thrown += 1;
        });
    });
    const worker = createInProcessOwnerSyncDbWorker(
      inMemoryDeps(new DatabaseSync(":memory:")),
    );
    worker.postMessage({ type: "linksync.ownersSyncedRequest" });
    worker.postMessage({ type: "linksync.ownersSyncedRequest" });

    let calls = 0;
    worker.onMessage(() => {
      calls += 1;
      if (calls === 1) throw new Error("page failed");
    });
    await macrotask();
    vi.unstubAllGlobals();

    expect(calls).toBe(2);
    expect(thrown).toBe(1);
  });

  it("reports owners to trackOwnerSync like a web worker", async () => {
    const owner = testAppOwner();
    const { createDbWorker, ownerSync } = trackOwnerSync(() =>
      createInProcessOwnerSyncDbWorker(
        inMemoryDeps(new DatabaseSync(":memory:")),
      ),
    );
    const worker = createDbWorker(SimpleName.orThrow("linky"));
    worker.onMessage(() => {});

    worker.postMessage({
      type: "useOwner",
      use: true,
      owner: { ...owner, transports: [] },
    });
    await macrotask();

    expect([...ownerSync.syncedOwners()]).toEqual([owner.id]);
  });

  it("runs a page callback after the worker's transaction, as a web worker does", async () => {
    const database = new DatabaseSync(":memory:");
    const deps = inMemoryDeps(database);
    const evolu = createEvolu({
      ...deps,
      reloadApp: () => {},
      createDbWorker: trackOwnerSync(() =>
        createInProcessOwnerSyncDbWorker(deps),
      ).createDbWorker,
    })(
      { note: { id: id("Note"), title: NonEmptyString } },
      { name: SimpleName.orThrow("InProcess"), transports: [], inMemory: true },
    );
    await evolu.appOwner;
    const errors: Array<ReturnType<typeof evolu.getError>> = [];

    // Evolu completes the insert from inside its transaction; a reset started
    // there would open a nested one and roll the insert back.
    const settled = new Promise<void>((resolve) => {
      evolu.subscribeError(() => {
        errors.push(evolu.getError());
        resolve();
      });
      evolu.insert(
        "note",
        { title: "saved" },
        {
          onComplete: () => {
            void evolu.resetAppOwner({ reload: false }).then(resolve);
          },
        },
      );
    });
    await settled;

    expect(errors).toEqual([]);
  });
});
