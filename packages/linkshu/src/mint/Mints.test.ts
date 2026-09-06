import type { GetInfoResponse } from "@cashu/cashu-ts";
import {
  Amount,
  getEncodedToken,
  Keyset,
  MintInfo as CashuMintInfo,
} from "@cashu/cashu-ts";
import { Effect, Exit, Layer } from "effect";
import {
  MintUrl,
  TokenRowId,
  TokenText,
  UnixSeconds,
} from "../domain/primitives";
import { Inspector } from "../inspector/Inspector";
import { KeyValueStore } from "../ports/KeyValueStore";
import { StoredTokenRow, TokenStore } from "../ports/TokenStore";
import { fakeWallet } from "../testing/fakeWallet";
import { recordingInspector } from "../testing/inspector";
import { MintInfo } from "./domain";
import type { LoadedWallet } from "./internal/WalletInstances";
import { seenMintKey, WalletInstances } from "./internal/WalletInstances";
import { Mints } from "./Mints";

const mint = MintUrl.make("https://mint.example");

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

const stubTokenStore = (
  rows: ReadonlyArray<StoredTokenRow>,
): Layer.Layer<TokenStore> =>
  Layer.succeed(TokenStore, {
    insert: () => Effect.die("not under test"),
    update: () => Effect.die("not under test"),
    remove: () => Effect.die("not under test"),
    loadAll: Effect.succeed(rows),
  });

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

const runMints = <A, E>(
  deps: Layer.Layer<WalletInstances | KeyValueStore | TokenStore | Inspector>,
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
        stubTokenStore([]),
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
          stubTokenStore([]),
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
        stubTokenStore([]),
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
  it("unions stored-row mints with seen mints, deduped, normalized, sorted", async () => {
    const encoded = getEncodedToken({
      mint: "https://mint.example",
      proofs: [
        {
          id: "009a1f293253e41e",
          amount: Amount.from(1),
          secret: "test-secret",
          C: "02" + "cd".repeat(32),
        },
      ],
    });
    const row = (id: string, tokenText: string): StoredTokenRow =>
      new StoredTokenRow({
        id: TokenRowId.make(id),
        originalTokenText: TokenText.make(tokenText),
        tokenText: TokenText.make(tokenText),
        state: "accepted",
        error: null,
        createdAt: UnixSeconds.make(1_700_000_000),
      });

    const seen = MintUrl.make("https://seen.example");
    const exit = await runMints(
      Layer.mergeAll(
        stubInstances(
          fakeWallet({
            keysetId: "01aaaa",
            getMintInfo: () => new CashuMintInfo(baseInfo),
          }),
        ),
        stubTokenStore([
          row("row-1", encoded),
          // Undecodable rows are skipped, not fatal.
          row("row-2", "cashuAgarbage"),
        ]),
        stubKv({
          [seenMintKey(seen)]: "https://seen.example",
          // Normalizes to the stored-row mint: must dedup.
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

    expect(exit).toEqual(
      Exit.succeed(["https://mint.example", "https://seen.example"]),
    );
  });
});
