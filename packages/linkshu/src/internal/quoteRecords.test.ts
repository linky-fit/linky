import { Effect } from "effect";
import {
  Amount,
  Bolt11Invoice,
  CurrencyUnit,
  KeysetId,
  MintUrl,
  NonNegativeAmount,
  QuoteId,
  UnixSeconds,
} from "../domain/primitives";
import { meltRecords } from "../melt/internal/meltRecords";
import { makeInMemoryKeyValueStore } from "../ports/inMemoryKeyValueStore";
import { makeInMemoryOperationStore } from "../ports/inMemoryOperationStore";
import type { OperationStoreService } from "../ports/OperationStore";
import { recordingInspector } from "../testing/inspector";

const draft = {
  quoteId: QuoteId.make("quote-1"),
  mint: MintUrl.make("https://mint.example"),
  unit: CurrencyUnit.make("sat"),
  keysetId: KeysetId.make("009a1f293253e41e"),
  invoice: Bolt11Invoice.make("lnbc1fakeinvoice"),
  amount: Amount.make(10),
  feeReserve: NonNegativeAmount.make(2),
  inputsTotal: Amount.make(13),
  expiresAt: null,
  createdAt: UnixSeconds.make(1),
  counter: null,
  envelope: null,
};

describe("quoteRecordStore", () => {
  it("patches a record by its id without scanning the stored operations", async () => {
    const store = makeInMemoryOperationStore();
    let scans = 0;
    const operationStore: OperationStoreService = {
      ...store,
      loadAll: Effect.suspend(() => {
        scans += 1;
        return store.loadAll;
      }),
    };
    const { events, service: inspector } = recordingInspector();
    const records = meltRecords({
      kv: makeInMemoryKeyValueStore(),
      operationStore,
      inspector,
    });

    const created = await Effect.runPromise(records.create(draft));
    const attempted = await Effect.runPromise(records.withCounter(created, 66));
    await Effect.runPromise(records.settle(attempted, "paid"));

    expect(scans).toBe(0);
    expect(await Effect.runPromise(store.loadAll)).toMatchObject([
      { id: created.id, status: "paid", counter: 66, error: null },
    ]);
    expect(events.at(-1)).toMatchObject({
      _tag: "OperationChanged",
      operationId: created.id,
      kind: "melt",
      from: "pending",
      to: "paid",
      reason: "melt-paid",
    });
  });
});
