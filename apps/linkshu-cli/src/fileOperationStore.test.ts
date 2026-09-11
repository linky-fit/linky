import {
  Amount,
  CurrencyUnit,
  MintUrl,
  NewOperation,
  QuoteId,
  UnixSeconds,
} from "@linky/linkshu";
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { makeFileOperationStore } from "./fileOperationStore";

const wallet = () => {
  const filePath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "linkshu-cli-")),
    "operations.json",
  );
  return { filePath, open: () => makeFileOperationStore(filePath) };
};

const melt = (quoteId: string): NewOperation =>
  new NewOperation({
    kind: "melt",
    status: "pending",
    mint: MintUrl.make("https://mint.example"),
    unit: CurrencyUnit.make("sat"),
    keysetId: null,
    amount: Amount.make(21),
    feeReserve: null,
    inputsTotal: null,
    quoteId: QuoteId.make(quoteId),
    invoice: null,
    sourceMint: null,
    counter: null,
    locked: null,
    expiresAt: null,
    createdAt: UnixSeconds.make(1_700_000_000),
    tokenText: null,
    error: null,
  });

describe("fileOperationStore", () => {
  it("derives the id from the operation key and upserts on it", async () => {
    const { open } = wallet();
    const first = await Effect.runPromise(open().insert(melt("q1")));
    const second = await Effect.runPromise(open().insert(melt("q1")));
    const other = await Effect.runPromise(open().insert(melt("q2")));
    expect(first.id).toBe(second.id);
    expect(other.id).not.toBe(first.id);
    expect(await Effect.runPromise(open().loadAll)).toHaveLength(2);
  });

  it("patches status and counter and survives a restart", async () => {
    const { open } = wallet();
    const stored = await Effect.runPromise(open().insert(melt("q1")));
    await Effect.runPromise(
      open().update(stored.id, { status: "paid", counter: 7 }),
    );
    const [reloaded] = await Effect.runPromise(open().loadAll);
    expect(reloaded).toMatchObject({ status: "paid", counter: 7 });
  });
});
