import {
  Amount,
  CurrencyUnit,
  KeysetId,
  MintUrl,
  NewProof,
} from "@linky/linkshu";
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { makeFileProofStore } from "./fileProofStore";

/** A fresh path plus a factory, so a test can simulate a process restart. */
const wallet = () => {
  const filePath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "linkshu-cli-")),
    "proofs.json",
  );
  return { filePath, open: () => makeFileProofStore(filePath) };
};

const proof = (secret: string, amount = 4): NewProof =>
  new NewProof({
    mint: MintUrl.make("https://mint.example"),
    unit: CurrencyUnit.make("sat"),
    keysetId: KeysetId.make("009a1f293253e41e"),
    amount: Amount.make(amount),
    secret,
    C: "02" + "ab".repeat(32),
    dleq: null,
    state: "available",
    operationId: null,
  });

describe("fileProofStore", () => {
  it("loads nothing from a wallet that has never been written", async () => {
    expect(await Effect.runPromise(wallet().open().loadAll)).toEqual([]);
  });

  it("derives the id from the secret and stamps a creation time", async () => {
    const { open } = wallet();
    const [stored] = await Effect.runPromise(open().insert([proof("aa")]));
    const [again] = await Effect.runPromise(open().insert([proof("aa")]));
    expect(stored?.id).toBe(again?.id);
    expect(stored?.createdAt).toBeGreaterThan(0);
    expect(await Effect.runPromise(open().loadAll)).toHaveLength(1);
  });

  it("survives the process that inserted the proofs", async () => {
    const { open } = wallet();
    await Effect.runPromise(open().insert([proof("aa"), proof("bb")]));

    const reloaded = await Effect.runPromise(open().loadAll);
    expect(reloaded.map((row) => row.secret).sort()).toEqual(["aa", "bb"]);
  });

  it("applies only the fields a sparse patch mentions", async () => {
    const { open } = wallet();
    const [stored] = await Effect.runPromise(open().insert([proof("aa")]));
    if (stored === undefined) throw new Error("nothing stored");
    await Effect.runPromise(open().update(stored.id, { state: "spent" }));

    const [updated] = await Effect.runPromise(open().loadAll);
    expect(updated?.state).toBe("spent");
    expect(updated?.operationId).toBeNull();
    expect(updated?.createdAt).toBe(stored.createdAt);
  });

  it("does not lose proofs inserted concurrently", async () => {
    const store = wallet().open();
    await Effect.runPromise(
      Effect.all(
        Array.from({ length: 25 }, (_unused, index) =>
          store.insert([proof(`x${index}`)]),
        ),
        { concurrency: "unbounded" },
      ),
    );
    expect(await Effect.runPromise(store.loadAll)).toHaveLength(25);
  });

  it("stores the port's own row shape, so the file stays hand-readable", async () => {
    const { filePath, open } = wallet();
    await Effect.runPromise(open().insert([proof("aa")]));

    const written: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(written).toMatchObject([
      { secret: "aa", state: "available", operationId: null },
    ]);
  });
});
