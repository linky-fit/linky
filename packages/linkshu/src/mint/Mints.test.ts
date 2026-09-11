import type { GetInfoResponse } from "@cashu/cashu-ts";
import { Keyset, MintInfo as CashuMintInfo } from "@cashu/cashu-ts";
import { Effect, Exit, Layer } from "effect";
import { MintInUse } from "../domain/errors";
import {
  Amount,
  CurrencyUnit,
  KeysetId,
  MintUrl,
  OperationId,
  ProofId,
  UnixSeconds,
} from "../domain/primitives";
import { Inspector } from "../inspector/Inspector";
import { KeyValueStore } from "../ports/KeyValueStore";
import { OperationStore, StoredOperation } from "../ports/OperationStore";
import type { OperationKind } from "../ports/OperationStore";
import { ProofStore, StoredProof } from "../ports/ProofStore";
import type { ProofState } from "../ports/ProofStore";
import { fakeWallet, KEYSET_HEX } from "../testing/fakeWallet";
import { recordingInspector } from "../testing/inspector";
import { MintInfo } from "./domain";
import type { LoadedWallet } from "./internal/WalletInstances";
import { seenMintKey, WalletInstances } from "./internal/WalletInstances";
import { Mints } from "./Mints";

const mint = MintUrl.make("https://mint.example");
const other = MintUrl.make("https://other.example");
const sat = CurrencyUnit.make("sat");

const baseInfo: GetInfoResponse = {
  name: "Test mint",
  pubkey: "02" + "ab".repeat(32),
  version: "Nutshell/0.16.0",
  contact: [],
  nuts: {
    "4": { methods: [], disabled: false },
    "5": { methods: [], disabled: false },
  },
};

const stubInstances = (loaded: LoadedWallet): Layer.Layer<WalletInstances> =>
  Layer.succeed(
    WalletInstances,
    WalletInstances.make({ get: () => Effect.succeed(loaded) }),
  );

const stubProofStore = (
  proofs: ReadonlyArray<StoredProof>,
): Layer.Layer<ProofStore> =>
  Layer.succeed(ProofStore, {
    insert: () => Effect.die("not under test"),
    update: () => Effect.die("not under test"),
    loadAll: Effect.succeed(proofs),
  });

const stubOperationStore = (
  operations: ReadonlyArray<StoredOperation>,
): Layer.Layer<OperationStore> =>
  Layer.succeed(OperationStore, {
    insert: () => Effect.die("not under test"),
    update: () => Effect.die("not under test"),
    loadAll: Effect.succeed(operations),
  });

const emptyStores = Layer.mergeAll(stubProofStore([]), stubOperationStore([]));

const stubKv = (entries: Record<string, string>): Layer.Layer<KeyValueStore> =>
  Layer.succeed(KeyValueStore, {
    get: (key) => Effect.succeed(entries[key] ?? null),
    set: () => Effect.die("not under test"),
    remove: () => Effect.die("not under test"),
    listKeys: (prefix) =>
      Effect.succeed(
        Object.keys(entries).filter((key) => key.startsWith(prefix)),
      ),
    tryAcquireLease: () => Effect.die("not under test"),
    releaseLease: () => Effect.die("not under test"),
  });

const recordingKv = (entries: Record<string, string>) => {
  const store = new Map(Object.entries(entries));
  const removed: Array<string> = [];
  const layer = Layer.succeed(KeyValueStore, {
    get: (key) => Effect.succeed(store.get(key) ?? null),
    set: (key, value) =>
      Effect.sync(() => {
        store.set(key, value);
      }),
    remove: (key) =>
      Effect.sync(() => {
        store.delete(key);
        removed.push(key);
      }),
    listKeys: (prefix) =>
      Effect.succeed([...store.keys()].filter((key) => key.startsWith(prefix))),
    tryAcquireLease: () => Effect.die("not under test"),
    releaseLease: () => Effect.die("not under test"),
  });
  return { layer, store, removed };
};

const proofAt = (id: string, mint: MintUrl, state: ProofState): StoredProof =>
  new StoredProof({
    id: ProofId.make(id),
    mint,
    unit: sat,
    keysetId: KeysetId.make(KEYSET_HEX),
    amount: Amount.make(1),
    secret: `secret-${id}`,
    C: "02" + "cd".repeat(32),
    dleq: null,
    state,
    operationId: null,
    createdAt: UnixSeconds.make(1_700_000_000),
  });

const operationAt = (
  id: string,
  kind: OperationKind,
  mint: MintUrl,
  sourceMint: MintUrl | null = null,
): StoredOperation =>
  new StoredOperation({
    id: OperationId.make(id),
    kind,
    status: "done",
    mint,
    unit: sat,
    keysetId: null,
    amount: Amount.make(1),
    feeReserve: null,
    inputsTotal: null,
    quoteId: null,
    invoice: null,
    sourceMint,
    counter: null,
    locked: null,
    expiresAt: null,
    createdAt: UnixSeconds.make(1_700_000_000),
    tokenText: null,
    error: null,
  });

const runMints = <A, E>(
  deps: Layer.Layer<
    WalletInstances | KeyValueStore | ProofStore | OperationStore | Inspector
  >,
  program: Effect.Effect<A, E, Mints>,
): Promise<Exit.Exit<A, E>> =>
  Effect.runPromiseExit(
    program.pipe(
      Effect.provide(
        Mints.DefaultWithoutDependencies.pipe(Layer.provide(deps)),
      ),
    ),
  );

describe("Mints.info", () => {
  it("builds MintInfo from the loaded wallet's bound keyset and published info", async () => {
    const loaded = fakeWallet({
      // Bound to the pricier keyset on purpose: info must report the bound
      // keyset's fee, not the cheapest one.
      keysetId: "01aaaa",
      keyChain: {
        getKeysets: () => [
          new Keyset("01aaaa", "sat", true, 120),
          new Keyset("01bbbb", "sat", true, 5),
        ],
      },
      getMintInfo: () =>
        new CashuMintInfo({
          ...baseInfo,
          icon_url: "https://mint.example/icon.png",
          nuts: {
            ...baseInfo.nuts,
            "15": { methods: [{ method: "bolt11", unit: "sat" }] },
          },
        }),
    });
    const inspector = recordingInspector();

    const exit = await runMints(
      Layer.mergeAll(
        stubInstances(loaded),
        emptyStores,
        stubKv({}),
        inspector.layer,
      ),
      Effect.gen(function* () {
        const mints = yield* Mints;
        return yield* mints.info(mint);
      }),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value).toEqual(
      new MintInfo({
        url: mint,
        name: "Test mint",
        inputFeePpk: 120,
        supportsMpp: true,
        isFakeLightning: false,
        iconUrl: "https://mint.example/icon.png",
      }),
    );

    expect(inspector.events).toEqual([
      expect.objectContaining({
        _tag: "OperationSucceeded",
        name: "mints.info",
        params: { mint },
        result: exit.value,
      }),
    ]);
  });

  it.each([
    { url: "https://mint.example", description: "Uses FakeWallet for testing" },
    {
      url: "https://mint.example",
      description: "All your Lightning invoices will always be marked paid",
    },
    { url: "https://testnut.cashu.space", description: "Testing" },
  ])(
    "identifies simulated Lightning at $url from $description",
    async ({ url, description }) => {
      const loaded = fakeWallet({
        getMintInfo: () => new CashuMintInfo({ ...baseInfo, description }),
      });
      const exit = await runMints(
        Layer.mergeAll(
          stubInstances(loaded),
          emptyStores,
          stubKv({}),
          Inspector.disabled,
        ),
        Effect.flatMap(Mints, (mints) => mints.info(MintUrl.make(url))),
      );
      assert(Exit.isSuccess(exit));
      expect(exit.value.isFakeLightning).toBe(true);
    },
  );

  it("reports absent optional mint fields as null and mpp as false", async () => {
    const loaded = fakeWallet({
      keysetId: "01aaaa",
      keyChain: {
        // No published input_fee_ppk on the bound keyset.
        getKeysets: () => [new Keyset("01aaaa", "sat", true)],
      },
      getMintInfo: () => new CashuMintInfo(baseInfo),
    });

    const exit = await runMints(
      Layer.mergeAll(
        stubInstances(loaded),
        emptyStores,
        stubKv({}),
        Inspector.disabled,
      ),
      Effect.gen(function* () {
        const mints = yield* Mints;
        return yield* mints.info(mint);
      }),
    );

    assert(Exit.isSuccess(exit));
    expect(exit.value).toEqual(
      new MintInfo({
        url: mint,
        name: "Test mint",
        inputFeePpk: null,
        supportsMpp: false,
        isFakeLightning: false,
        iconUrl: null,
      }),
    );
  });
});

describe("Mints.knownMints", () => {
  it("unions proof, operation, and seen mints, deduped, normalized, sorted", async () => {
    const seen = MintUrl.make("https://seen.example");
    const target = MintUrl.make("https://target.example");
    const source = MintUrl.make("https://source.example");

    const exit = await runMints(
      Layer.mergeAll(
        stubInstances(
          fakeWallet({
            keysetId: "01aaaa",
            getMintInfo: () => new CashuMintInfo(baseInfo),
          }),
        ),
        stubProofStore([
          proofAt("p-1", mint, "available"),
          // Any state counts: a spent proof still names where funds were.
          proofAt("p-2", mint, "spent"),
        ]),
        stubOperationStore([
          // An autoswap names both ends of the move.
          operationAt("op-1", "autoswap", target, source),
        ]),
        stubKv({
          [seenMintKey(seen)]: "https://seen.example",
          // Normalizes to the stored-proof mint: must dedup.
          ["linkshu.seenMints." + encodeURIComponent("https://mint.example/")]:
            "https://mint.example/",
          // Invalid seen values are skipped.
          ["linkshu.seenMints.garbage"]: "not-a-url",
        }),
        Inspector.disabled,
      ),
      Effect.gen(function* () {
        const mints = yield* Mints;
        return yield* mints.knownMints;
      }),
    );

    expect(exit).toEqual(Exit.succeed([mint, seen, source, target]));
  });
});

describe("Mints.addKnownMint", () => {
  it("records the mint as seen without loading its wallet", async () => {
    const kv = recordingKv({});
    const inspector = recordingInspector();
    const instances = Layer.succeed(
      WalletInstances,
      WalletInstances.make({ get: () => Effect.die("must not load") }),
    );

    const exit = await runMints(
      Layer.mergeAll(instances, emptyStores, kv.layer, inspector.layer),
      Effect.gen(function* () {
        const mints = yield* Mints;
        yield* mints.addKnownMint(mint);
        return yield* mints.knownMints;
      }),
    );

    expect(exit).toEqual(Exit.succeed([mint]));
    expect(kv.store.get(seenMintKey(mint))).toBe(mint);
    expect(inspector.events).toEqual([
      expect.objectContaining({
        _tag: "OperationSucceeded",
        name: "mints.addKnownMint",
        params: { mint },
      }),
    ]);
  });
});

describe("Mints.removeKnownMint", () => {
  const instances = Layer.succeed(
    WalletInstances,
    WalletInstances.make({ get: () => Effect.die("must not load") }),
  );

  it("forgets a seen mint no proof names", async () => {
    const kv = recordingKv({ [seenMintKey(mint)]: mint });
    const inspector = recordingInspector();

    const exit = await runMints(
      Layer.mergeAll(
        instances,
        stubProofStore([proofAt("p-1", other, "available")]),
        stubOperationStore([]),
        kv.layer,
        inspector.layer,
      ),
      Effect.gen(function* () {
        const mints = yield* Mints;
        yield* mints.removeKnownMint(mint);
        return yield* mints.knownMints;
      }),
    );

    expect(exit).toEqual(Exit.succeed([other]));
    expect(kv.removed).toEqual([seenMintKey(mint)]);
    expect(inspector.events).toEqual([
      expect.objectContaining({
        _tag: "OperationSucceeded",
        name: "mints.removeKnownMint",
        params: { mint },
      }),
    ]);
  });

  it("ignores spent proofs when deciding whether the mint is in use", async () => {
    const kv = recordingKv({ [seenMintKey(mint)]: mint });

    const exit = await runMints(
      Layer.mergeAll(
        instances,
        stubProofStore([proofAt("p-1", mint, "spent")]),
        stubOperationStore([]),
        kv.layer,
        Inspector.disabled,
      ),
      Effect.flatMap(Mints, (mints) => mints.removeKnownMint(mint)),
    );

    expect(exit).toEqual(Exit.succeed(undefined));
    expect(kv.removed).toEqual([seenMintKey(mint)]);
  });

  it.each([
    "available",
    "held",
    "handedOut",
    "externalized",
  ] as const satisfies ReadonlyArray<ProofState>)(
    "refuses while a %s proof still names the mint",
    async (state) => {
      const kv = recordingKv({ [seenMintKey(mint)]: mint });
      const inspector = recordingInspector();

      const exit = await runMints(
        Layer.mergeAll(
          instances,
          stubProofStore([
            proofAt("p-1", mint, state),
            proofAt("p-2", other, "available"),
          ]),
          stubOperationStore([]),
          kv.layer,
          inspector.layer,
        ),
        Effect.flatMap(Mints, (mints) => mints.removeKnownMint(mint)),
      );

      expect(exit).toEqual(Exit.fail(new MintInUse({ mint, proofCount: 1 })));
      expect(kv.removed).toEqual([]);
      expect(inspector.events).toEqual([
        expect.objectContaining({
          _tag: "OperationFailed",
          name: "mints.removeKnownMint",
          params: { mint },
          error: new MintInUse({ mint, proofCount: 1 }),
        }),
      ]);
    },
  );
});
