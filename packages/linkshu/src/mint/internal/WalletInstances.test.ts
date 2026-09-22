import type { GetInfoResponse } from "@cashu/cashu-ts";
import {
  HttpResponseError,
  MintInfo as CashuMintInfo,
  MintOperationError,
} from "@cashu/cashu-ts";
import { Effect, Either, Exit } from "effect";
import { CurrencyUnit, MintUrl } from "../../domain/primitives";
import { LeaseId } from "../../ports/KeyValueStore";
import type { KeyValueStoreService } from "../../ports/KeyValueStore";
import { makeInMemoryKeyValueStore } from "../../ports/inMemoryKeyValueStore";
import { fakeWallet as stubWallet } from "../../testing/fakeWallet";
import type { LoadedWallet, WalletLoader } from "./WalletInstances";
import {
  classifyMintError,
  keysetMintKey,
  makeWalletInstances,
  seenMintKey,
} from "./WalletInstances";

const mint = MintUrl.make("https://mint.example");
const sat = CurrencyUnit.make("sat");
const msat = CurrencyUnit.make("msat");

const infoFixture: GetInfoResponse = {
  name: "Test mint",
  pubkey: "02" + "ab".repeat(32),
  version: "Nutshell/0.16.0",
  contact: [],
  nuts: {
    "4": { methods: [], disabled: false },
    "5": { methods: [], disabled: false },
  },
};

const fakeWallet = (keysetId: string): LoadedWallet =>
  stubWallet({ keysetId, getMintInfo: () => new CashuMintInfo(infoFixture) });

const stubKv = (sets: Array<[string, string]>): KeyValueStoreService => {
  const store = new Map<string, string>();
  return {
    get: (key) => Effect.succeed(store.get(key) ?? null),
    set: (key, value) =>
      Effect.sync(() => {
        store.set(key, value);
        sets.push([key, value]);
      }),
    remove: () => Effect.die("not under test"),
    listKeys: () => Effect.die("not under test"),
    // A trivially-granting lease: the binding tests are single-threaded, so
    // mutual exclusion is exercised separately with the in-memory store.
    tryAcquireLease: () => Effect.succeed(LeaseId.make("lease")),
    releaseLease: () => Effect.void,
  };
};

describe("makeWalletInstances", () => {
  it("shares one load between concurrent callers for the same mint/unit", async () => {
    const wallet = fakeWallet("01aaaa");
    let calls = 0;
    const load: WalletLoader = () => {
      calls += 1;
      return new Promise((resolve) => {
        setTimeout(() => resolve(wallet), 0);
      });
    };
    const instances = makeWalletInstances(stubKv([]), load);

    const exit = await Effect.runPromiseExit(
      Effect.all([instances.get(mint, sat), instances.get(mint, sat)], {
        concurrency: "unbounded",
      }),
    );

    assert(Exit.isSuccess(exit));
    expect(calls).toBe(1);
    expect(exit.value[0]).toBe(wallet);
    expect(exit.value[1]).toBe(wallet);
  });

  it("loads separately per unit and keeps successful loads cached", async () => {
    const sets: Array<[string, string]> = [];
    let calls = 0;
    const load: WalletLoader = (_mint, unit) => {
      calls += 1;
      return Promise.resolve(fakeWallet(`keyset-${unit}`));
    };
    const instances = makeWalletInstances(stubKv(sets), load);

    const first = await Effect.runPromise(instances.get(mint, sat));
    const second = await Effect.runPromise(instances.get(mint, sat));
    expect(calls).toBe(1);
    expect(second).toBe(first);

    await Effect.runPromise(instances.get(mint, msat));
    expect(calls).toBe(2);

    // Each fresh load binds its keyset id to the mint and records it as seen;
    // the cached second `sat` load re-checks the binding without writing.
    expect(sets).toEqual([
      [keysetMintKey("keyset-sat"), mint],
      [seenMintKey(mint), mint],
      [keysetMintKey("keyset-msat"), mint],
      [seenMintKey(mint), mint],
    ]);
  });

  it("surfaces classified failures and retries after eviction", async () => {
    const wallet = fakeWallet("01aaaa");
    let calls = 0;
    const load: WalletLoader = () => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new TypeError("fetch failed"))
        : Promise.resolve(wallet);
    };
    const instances = makeWalletInstances(stubKv([]), load);

    const failed = await Effect.runPromiseExit(instances.get(mint, sat));
    expect(failed).toEqual(
      Exit.fail(
        expect.objectContaining({
          _tag: "MintUnreachable",
          mint,
          detail: "TypeError: fetch failed",
        }),
      ),
    );

    const retried = await Effect.runPromise(instances.get(mint, sat));
    expect(calls).toBe(2);
    expect(retried).toBe(wallet);
  });
});

describe("keyset id / mint binding (LNK-01)", () => {
  const honest = MintUrl.make("https://cashu.cz");
  const evil = MintUrl.make("https://evil.example");
  const keyset = "00ad268c4d1f5826";

  const loaderFor = (byMint: Record<string, string>): WalletLoader => {
    let calls = 0;
    const load: WalletLoader = (m) => {
      calls += 1;
      return Promise.resolve(fakeWallet(byMint[m] ?? "unknown"));
    };
    return Object.assign(load, {
      get calls() {
        return calls;
      },
    });
  };

  it("binds a keyset id to the first mint that presents it", async () => {
    const sets: Array<[string, string]> = [];
    const instances = makeWalletInstances(
      stubKv(sets),
      loaderFor({ [honest]: keyset }),
    );

    await Effect.runPromise(instances.get(honest, sat));

    expect(sets).toContainEqual([keysetMintKey(keyset), honest]);
  });

  it("rejects a mint presenting a keyset id bound to another mint", async () => {
    const instances = makeWalletInstances(
      stubKv([]),
      loaderFor({ [honest]: keyset, [evil]: keyset }),
    );

    await Effect.runPromise(instances.get(honest, sat));
    const rejected = await Effect.runPromiseExit(instances.get(evil, sat));

    assert(Exit.isFailure(rejected));
    expect(rejected).toEqual(
      Exit.fail(
        expect.objectContaining({
          _tag: "MintRejected",
          mint: evil,
        }),
      ),
    );
  });

  it("keeps rejecting the impostor on the cached path", async () => {
    const instances = makeWalletInstances(
      stubKv([]),
      loaderFor({ [honest]: keyset, [evil]: keyset }),
    );

    await Effect.runPromise(instances.get(honest, sat));
    const first = await Effect.runPromiseExit(instances.get(evil, sat));
    const second = await Effect.runPromiseExit(instances.get(evil, sat));

    expect(Exit.isFailure(first)).toBe(true);
    expect(Exit.isFailure(second)).toBe(true);
  });

  it("lets the same mint keep using its own keyset id across reloads", async () => {
    const instances = makeWalletInstances(
      stubKv([]),
      loaderFor({ [honest]: keyset }),
    );

    const first = await Effect.runPromise(instances.get(honest, sat));
    const second = await Effect.runPromise(instances.get(honest, sat));
    expect(second).toBe(first);
  });

  it("rejects a mint whose keyset id is already held under another mint", async () => {
    // Empty binding store (as after an upgrade), but the wallet already holds
    // proofs under the honest mint for this keyset. The impostor must be
    // rejected from the holdings, not accepted just for loading first.
    const instances = makeWalletInstances(
      stubKv([]),
      loaderFor({ [evil]: keyset }),
      () => Effect.succeed(honest),
    );

    const rejected = await Effect.runPromiseExit(instances.get(evil, sat));
    assert(Exit.isFailure(rejected));
    expect(rejected).toEqual(
      Exit.fail(expect.objectContaining({ _tag: "MintRejected", mint: evil })),
    );
  });

  it("serializes concurrent claims so only one mint binds an unbound keyset", async () => {
    // A real lease store: two mints presenting the same keyset id load at once.
    const instances = makeWalletInstances(
      makeInMemoryKeyValueStore(),
      loaderFor({ [honest]: keyset, [evil]: keyset }),
    );

    const outcomes = await Effect.runPromise(
      Effect.all(
        [
          Effect.either(instances.get(honest, sat)),
          Effect.either(instances.get(evil, sat)),
        ],
        { concurrency: "unbounded" },
      ),
    );
    const successes = outcomes.filter(Either.isRight).length;
    const failures = outcomes.filter(Either.isLeft).length;
    expect(successes).toBe(1);
    expect(failures).toBe(1);
  });

  it("does not bind or crash for a mint with no active keyset", async () => {
    const sets: Array<[string, string]> = [];
    const load: WalletLoader = () =>
      Promise.resolve(
        new Proxy(fakeWallet(keyset), {
          get(target, prop, receiver) {
            if (prop === "keysetId") {
              throw new Error("no active keyset");
            }
            return Reflect.get(target, prop, receiver);
          },
        }),
      );
    const instances = makeWalletInstances(stubKv(sets), load);

    // Loading succeeds (restore-only access), and nothing is bound.
    await Effect.runPromise(instances.get(honest, sat));
    expect(sets.some(([key]) => key.startsWith("linkshu.keysetMint."))).toBe(
      false,
    );
  });
});

describe("classifyMintError", () => {
  it("maps protocol errors to MintRejected with the NUT code", () => {
    const classified = classifyMintError(
      mint,
      new MintOperationError(11001, "Token already spent"),
    );
    expect(classified._tag).toBe("MintRejected");
    if (classified._tag !== "MintRejected") return;
    expect(classified.code).toBe(11001);
  });

  it("maps 5xx responses to MintUnreachable and 4xx to MintRejected", () => {
    expect(
      classifyMintError(mint, new HttpResponseError("Bad gateway", 502))._tag,
    ).toBe("MintUnreachable");
    expect(
      classifyMintError(mint, new HttpResponseError("Not found", 404))._tag,
    ).toBe("MintRejected");
  });

  it("maps network-shaped failures to MintUnreachable and the rest to MintRejected", () => {
    expect(classifyMintError(mint, new TypeError("fetch failed"))._tag).toBe(
      "MintUnreachable",
    );
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(classifyMintError(mint, abort)._tag).toBe("MintUnreachable");
    expect(
      classifyMintError(
        mint,
        new Error("No active sat keyset found for https://mint.example"),
      )._tag,
    ).toBe("MintRejected");
    expect(
      classifyMintError(
        mint,
        new Error("Mint keys for keyset 01884a74bb2fc5ee are unavailable"),
      )._tag,
    ).toBe("MintRejected");
  });
});
