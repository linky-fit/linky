import type {
  MeltQuoteBolt11Response,
  MintQuoteBolt11Response,
} from "@cashu/cashu-ts";
import { Amount as CashuAmount } from "@cashu/cashu-ts";
import { Effect, Exit, Layer } from "effect";
import { Amount, MintUrl, NonNegativeAmount } from "../domain/primitives";
import { WalletInstances } from "../mint/internal/WalletInstances";
import type { LoadedWallet } from "../mint/internal/WalletInstances";
import { makeInMemoryKeyValueStore } from "../ports/inMemoryKeyValueStore";
import { KeyValueStore } from "../ports/KeyValueStore";
import type { KeyValueStoreService } from "../ports/KeyValueStore";
import { fakeWallet } from "../testing/fakeWallet";
import { recordingInspector } from "../testing/inspector";
import { FeeProbeDraft, LightningFeeProbeResult } from "./domain";
import { FeeProbe } from "./FeeProbe";
import { writeCachedFeeProbe } from "./internal/feeProbeCache";

const mint = MintUrl.make("https://mint.example");
const probeMint = MintUrl.make("https://probe.example");
const draft = new FeeProbeDraft({ mint, probeMint });

const invoice = "lnbc100u1pexampleinvoice";

const mintQuote = (): MintQuoteBolt11Response => ({
  quote: "mint-quote-1",
  request: invoice,
  unit: "sat",
  amount: CashuAmount.from(10_000),
  state: "UNPAID",
  expiry: null,
});

const meltQuote = (
  over?: Partial<MeltQuoteBolt11Response>,
): MeltQuoteBolt11Response => ({
  quote: "melt-quote-1",
  amount: CashuAmount.from(10_000),
  unit: "sat",
  state: "UNPAID",
  expiry: 0,
  request: invoice,
  fee_reserve: CashuAmount.from(101),
  payment_preimage: null,
  ...over,
});

interface FakeMintsArgs {
  readonly createMintQuote?: () => Promise<MintQuoteBolt11Response>;
  readonly createMeltQuote?: () => Promise<MeltQuoteBolt11Response>;
}

const makeWallets = (args: FakeMintsArgs) => {
  const calls: string[] = [];
  const wallet = (url: MintUrl): LoadedWallet =>
    fakeWallet({
      createMintQuoteBolt11: () => {
        calls.push(`mintQuote:${url}`);
        return args.createMintQuote?.() ?? Promise.resolve(mintQuote());
      },
      createMeltQuoteBolt11: () => {
        calls.push(`meltQuote:${url}`);
        return args.createMeltQuote?.() ?? Promise.resolve(meltQuote());
      },
    });
  return { calls, wallet };
};

const makeHarness = (
  args: FakeMintsArgs,
  kv: KeyValueStoreService = makeInMemoryKeyValueStore(),
) => {
  const inspector = recordingInspector();
  const { calls, wallet } = makeWallets(args);
  const layer = FeeProbe.DefaultWithoutDependencies.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.succeed(
          WalletInstances,
          WalletInstances.make({ get: (url) => Effect.succeed(wallet(url)) }),
        ),
        Layer.succeed(KeyValueStore, kv),
        inspector.layer,
      ),
    ),
  );
  const run = <A, E>(program: Effect.Effect<A, E, FeeProbe>) =>
    Effect.runPromiseExit(program.pipe(Effect.provide(layer)));
  return { run, events: inspector.events, calls, kv };
};

const probe = (input: FeeProbeDraft = draft) =>
  Effect.flatMap(FeeProbe, (service) => service.probeLightningFee(input));

describe("FeeProbe", () => {
  it("prices a melt quote against another mint's invoice", async () => {
    const { run, events, calls } = makeHarness({});

    const exit = await run(probe());

    assert(Exit.isSuccess(exit));
    expect(exit.value.amount).toBe(10_000);
    expect(exit.value.feeReserve).toBe(101);
    expect(exit.value.percent).toBeCloseTo(1.01);
    // The invoice comes from the probe mint, the price from the mint measured.
    expect(calls).toEqual([`mintQuote:${probeMint}`, `meltQuote:${mint}`]);

    const probed = events.filter(
      (event) => event._tag === "LightningFeeProbed",
    );
    expect(probed).toHaveLength(1);
    // Both quote ids travel, as the web app's cashu inspector row does.
    expect(probed[0]).toMatchObject({
      mint,
      probeMint,
      meltQuoteId: "melt-quote-1",
      mintQuoteId: "mint-quote-1",
      feeReserve: 101,
    });
    expect(
      events.some(
        (event) =>
          event._tag === "OperationSucceeded" &&
          event.name === "feeProbe.probeLightningFee",
      ),
    ).toBe(true);
  });

  it("serves a fresh cached estimate without asking either mint", async () => {
    const kv = makeInMemoryKeyValueStore();
    const first = makeHarness({}, kv);
    assert(Exit.isSuccess(await first.run(probe())));

    const second = makeHarness({}, kv);
    const exit = await second.run(probe());

    assert(Exit.isSuccess(exit));
    expect(exit.value.feeReserve).toBe(101);
    expect(second.calls).toEqual([]);
    expect(
      second.events.filter((event) => event._tag === "LightningFeeProbed"),
    ).toEqual([]);
  });

  it("re-probes once the cached estimate has aged out", async () => {
    const kv = makeInMemoryKeyValueStore();
    const stale = new LightningFeeProbeResult({
      mint,
      probeMint,
      amount: Amount.make(10_000),
      feeReserve: NonNegativeAmount.make(9),
      percent: 0.09,
    });
    await Effect.runPromise(
      writeCachedFeeProbe(kv, stale, Math.floor(Date.now() / 1000) - 25 * 3600),
    );

    const { run, calls } = makeHarness({}, kv);
    const exit = await run(probe());

    assert(Exit.isSuccess(exit));
    expect(exit.value.feeReserve).toBe(101);
    expect(calls).toHaveLength(2);
  });

  it("uses the requested amount when the mint echoes no usable one", async () => {
    const { run } = makeHarness({
      createMeltQuote: () =>
        Promise.resolve(meltQuote({ amount: CashuAmount.from(0) })),
    });

    const exit = await run(
      probe(new FeeProbeDraft({ mint, probeMint, amount: Amount.make(2_000) })),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value.amount).toBe(2_000);
    expect(exit.value.percent).toBeCloseTo(5.05);
  });

  it("rejects a melt quote without a usable quote id", async () => {
    const { run, kv } = makeHarness({
      createMeltQuote: () => Promise.resolve(meltQuote({ quote: "" })),
    });

    const exit = await run(Effect.either(probe()));

    assert(Exit.isSuccess(exit));
    assert(exit.value._tag === "Left");
    expect(exit.value.left._tag).toBe("MintRejected");
    // A failed probe caches nothing.
    expect(await Effect.runPromise(kv.listKeys("linkshu.feeProbe."))).toEqual(
      [],
    );
  });

  it("reports the probe mint when it cannot be reached", async () => {
    const { run } = makeHarness({
      createMintQuote: () => Promise.reject(new TypeError("Failed to fetch")),
    });

    const exit = await run(Effect.either(probe()));

    assert(Exit.isSuccess(exit));
    assert(exit.value._tag === "Left");
    expect(exit.value.left).toMatchObject({
      _tag: "MintUnreachable",
      mint: probeMint,
    });
  });
});
