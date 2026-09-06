import type { GetInfoResponse } from "@cashu/cashu-ts";
import {
  HttpResponseError,
  MintInfo as CashuMintInfo,
  MintOperationError,
} from "@cashu/cashu-ts";
import { Effect, Exit } from "effect";
import { CurrencyUnit, MintUrl } from "../../domain/primitives";
import type { KeyValueStoreService } from "../../ports/KeyValueStore";
import { fakeWallet as stubWallet } from "../../testing/fakeWallet";
import type { LoadedWallet, WalletLoader } from "./WalletInstances";
import {
  classifyMintError,
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

const stubKv = (sets: Array<[string, string]>): KeyValueStoreService => ({
  get: () => Effect.succeed(null),
  set: (key, value) =>
    Effect.sync(() => {
      sets.push([key, value]);
    }),
  remove: () => Effect.die("not under test"),
  listKeys: () => Effect.die("not under test"),
  tryAcquireLease: () => Effect.die("not under test"),
  releaseLease: () => Effect.die("not under test"),
});

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

    // Only the creating load records the mint as seen.
    expect(sets).toEqual([
      [seenMintKey(mint), mint],
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
