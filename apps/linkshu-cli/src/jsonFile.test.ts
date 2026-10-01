import { describe, expect, it } from "bun:test";
import { Effect, Schema } from "effect";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { makeJsonFile } from "./jsonFile";

const Counters = Schema.Record({ key: Schema.String, value: Schema.Number });

const temporaryFile = (name: string): string =>
  path.join(fs.mkdtempSync(path.join(os.tmpdir(), "linkshu-cli-")), name);

const countersAt = (filePath: string) => makeJsonFile(filePath, Counters, {});

describe("makeJsonFile", () => {
  it("reads the empty value until something is written", () => {
    const file = countersAt(temporaryFile("counters.json"));
    expect(Effect.runSync(file.read)).toEqual({});
  });

  it("survives the instance that wrote it", async () => {
    const filePath = temporaryFile("counters.json");
    await Effect.runPromise(
      countersAt(filePath).modify(() => [{ a: 1 }, null]),
    );
    expect(await Effect.runPromise(countersAt(filePath).read)).toEqual({
      a: 1,
    });
  });

  it("returns the value the change function produced", async () => {
    const file = countersAt(temporaryFile("counters.json"));
    expect(
      await Effect.runPromise(file.modify(() => [{ a: 1 }, "result"])),
    ).toBe("result");
  });

  it("serializes concurrent modifications instead of losing updates", async () => {
    const file = countersAt(temporaryFile("counters.json"));
    const increment = file.modify((current) => [
      { total: (current["total"] ?? 0) + 1 },
      null,
    ]);

    await Effect.runPromise(
      Effect.all(
        Array.from({ length: 50 }, () => increment),
        {
          concurrency: "unbounded",
        },
      ),
    );

    expect(await Effect.runPromise(file.read)).toEqual({ total: 50 });
  });

  it("leaves no lock or temp files behind", async () => {
    const filePath = temporaryFile("counters.json");
    await Effect.runPromise(
      countersAt(filePath).modify(() => [{ a: 1 }, null]),
    );
    expect(fs.readdirSync(path.dirname(filePath))).toEqual(["counters.json"]);
  });

  it("refuses to silently start over on unreadable contents", () => {
    const filePath = temporaryFile("counters.json");
    fs.writeFileSync(filePath, "{ not json");
    expect(() => Effect.runSync(countersAt(filePath).read)).toThrow();
  });

  it("breaks a lock left behind by a process that died holding it", async () => {
    const filePath = temporaryFile("counters.json");
    const staleLock = `${filePath}.lock`;
    fs.writeFileSync(staleLock, "");
    const longAgo = new Date(Date.now() - 60_000);
    fs.utimesSync(staleLock, longAgo, longAgo);

    await Effect.runPromise(
      countersAt(filePath).modify(() => [{ a: 1 }, null]),
    );
    expect(await Effect.runPromise(countersAt(filePath).read)).toEqual({
      a: 1,
    });
  });
});

describe("makeJsonFile across processes", () => {
  it("does not lose updates when separate processes write at once", async () => {
    const filePath = temporaryFile("counters.json");
    const workerPath = path.join(path.dirname(filePath), "worker.ts");
    // The worker sits outside the workspace, where a bare "effect" import
    // makes Bun auto-install the latest major instead of the workspace's.
    fs.writeFileSync(
      workerPath,
      `import { Effect, Schema } from ${JSON.stringify(Bun.resolveSync("effect", import.meta.dir))};
       import { makeJsonFile } from ${JSON.stringify(path.join(import.meta.dir, "jsonFile.ts"))};
       const file = makeJsonFile(
         ${JSON.stringify(filePath)},
         Schema.Record({ key: Schema.String, value: Schema.Number }),
         {},
       );
       for (let i = 0; i < 20; i += 1)
         await Effect.runPromise(
           file.modify((current) => [{ total: (current["total"] ?? 0) + 1 }, null]),
         );`,
    );

    const workers = Array.from({ length: 4 }, () =>
      Bun.spawn(["bun", workerPath], { stdout: "pipe", stderr: "pipe" }),
    );
    const exits = await Promise.all(workers.map((worker) => worker.exited));

    expect(exits).toEqual([0, 0, 0, 0]);
    expect(
      await Effect.runPromise(makeJsonFile(filePath, Counters, {}).read),
    ).toEqual({ total: 80 });
  }, 30_000);
});
