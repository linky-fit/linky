import { Effect } from "effect";
import {
  Amount,
  Bolt11Invoice,
  CurrencyUnit,
  KeysetId,
  MintUrl,
  QuoteId,
  UnixSeconds,
} from "../../domain/primitives";
import { makeInMemoryKeyValueStore } from "../../ports/inMemoryKeyValueStore";
import {
  PENDING_TOPUP_KEY_PREFIX,
  PENDING_TOPUP_TTL_SECONDS,
  PendingTopup,
  pendingTopups,
} from "./pendingTopup";

const mint = MintUrl.make("https://mint.example");
const createdAt = 1_700_000_000;

const pending = (fields?: {
  quoteId?: string;
  expiresAt?: number | null;
  mintCounter?: number | null;
}): PendingTopup =>
  new PendingTopup({
    quoteId: QuoteId.make(fields?.quoteId ?? "quote-1"),
    mint,
    unit: CurrencyUnit.make("sat"),
    keysetId: KeysetId.make("009a1f293253e41e"),
    amount: Amount.make(16),
    invoice: Bolt11Invoice.make("lnbc160n1pexample"),
    expiresAt:
      fields?.expiresAt === undefined || fields.expiresAt === null
        ? null
        : UnixSeconds.make(fields.expiresAt),
    createdAt: UnixSeconds.make(createdAt),
    mintCounter: fields?.mintCounter ?? null,
  });

describe("pendingTopups.key", () => {
  it("namespaces and escapes the mint and quote id", () => {
    expect(pendingTopups.key(mint, QuoteId.make("a/b c"))).toBe(
      `${PENDING_TOPUP_KEY_PREFIX}https%3A%2F%2Fmint.example.a%2Fb%20c`,
    );
  });

  it("keeps two quotes at one mint apart", () => {
    expect(pendingTopups.key(mint, QuoteId.make("one"))).not.toBe(
      pendingTopups.key(mint, QuoteId.make("two")),
    );
  });
});

describe("pending topup records", () => {
  it("roundtrips through the key-value port", async () => {
    const kv = makeInMemoryKeyValueStore();
    const record = pending({ mintCounter: 7, expiresAt: createdAt + 600 });

    await Effect.runPromise(pendingTopups.write(kv, record));
    const [stored] = await Effect.runPromise(pendingTopups.readAll(kv));

    expect(stored).toEqual(record);
    expect(stored?.mintCounter).toBe(7);

    await Effect.runPromise(pendingTopups.remove(kv, record));
    expect(await Effect.runPromise(pendingTopups.readAll(kv))).toEqual([]);
  });

  it("drops entries that no longer decode instead of failing the read", async () => {
    const kv = makeInMemoryKeyValueStore();
    await Effect.runPromise(pendingTopups.write(kv, pending()));
    await Effect.runPromise(
      kv.set(`${PENDING_TOPUP_KEY_PREFIX}corrupt`, "{not json"),
    );

    const stored = await Effect.runPromise(pendingTopups.readAll(kv));
    expect(stored).toHaveLength(1);
    expect(stored[0]?.quoteId).toBe("quote-1");
  });
});

describe("pendingTopups.deadlineOf", () => {
  it("uses the mint-stated expiry when there is one", () => {
    expect(
      pendingTopups.deadlineOf(pending({ expiresAt: createdAt + 600 })),
    ).toBe(createdAt + 600);
  });

  it("falls back to the day-long ttl when the mint states no expiry", () => {
    expect(pendingTopups.deadlineOf(pending())).toBe(
      createdAt + PENDING_TOPUP_TTL_SECONDS,
    );
  });
});
