import { Effect } from "effect";
import {
  Amount,
  Bolt11Invoice,
  CurrencyUnit,
  KeysetId,
  MintUrl,
  NonNegativeAmount,
  QuoteId,
  TokenRowId,
  UnixSeconds,
} from "../../domain/primitives";
import { makeInMemoryKeyValueStore } from "../../ports/inMemoryKeyValueStore";
import {
  PENDING_MELT_KEY_PREFIX,
  PendingMelt,
  pendingMelts,
} from "./pendingMelt";

const mint = MintUrl.make("https://mint.example");

const pending = (blankCounter: number | null): PendingMelt =>
  new PendingMelt({
    quoteId: QuoteId.make("quote-1"),
    mint,
    unit: CurrencyUnit.make("sat"),
    keysetId: KeysetId.make("009a1f293253e41e"),
    invoice: Bolt11Invoice.make("lnbc160n1pexample"),
    amount: Amount.make(10),
    feeReserve: NonNegativeAmount.make(2),
    inputsTotal: Amount.make(13),
    rowId: TokenRowId.make("row-1"),
    expiresAt: null,
    createdAt: UnixSeconds.make(1_700_000_000),
    blankCounter,
  });

describe("pending melt records", () => {
  it("namespaces the key by mint and quote id", () => {
    expect(pendingMelts.key(mint, QuoteId.make("a/b"))).toBe(
      `${PENDING_MELT_KEY_PREFIX}https%3A%2F%2Fmint.example.a%2Fb`,
    );
  });

  it("roundtrips through the key-value port, blank slot included", async () => {
    const kv = makeInMemoryKeyValueStore();
    const record = pending(66);

    await Effect.runPromise(pendingMelts.write(kv, record));
    const [stored] = await Effect.runPromise(pendingMelts.readAll(kv));
    expect(stored).toEqual(record);
    expect(stored?.blankCounter).toBe(66);

    await Effect.runPromise(pendingMelts.remove(kv, record));
    expect(await Effect.runPromise(pendingMelts.readAll(kv))).toEqual([]);
  });

  it("drops entries that no longer decode instead of failing the read", async () => {
    const kv = makeInMemoryKeyValueStore();
    await Effect.runPromise(pendingMelts.write(kv, pending(null)));
    await Effect.runPromise(
      kv.set(`${PENDING_MELT_KEY_PREFIX}corrupt`, "{not json"),
    );

    const stored = await Effect.runPromise(pendingMelts.readAll(kv));
    expect(stored.map((record) => record.quoteId)).toEqual(["quote-1"]);
  });
});
