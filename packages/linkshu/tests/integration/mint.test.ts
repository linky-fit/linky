import { Effect } from "effect";
import { Bip39Seed, Mints, runLinkshu } from "../../src";
import { mintUrl } from "./helpers";

const seed = Bip39Seed.make(new Uint8Array(64).fill(7));

describe("local mint via the public API", () => {
  it("loads the mint's keysets and reports its info", async () => {
    const info = await runLinkshu(
      { bip39Seed: seed },
      Effect.gen(function* () {
        const mints = yield* Mints;
        return yield* mints.info(mintUrl);
      }),
    );

    expect(info.url).toBe(mintUrl);
    expect(info.name).toBeTruthy();
    // The local mint is deliberately not fee-free (see CLAUDE.md).
    expect(info.inputFeePpk).toBe(100);
    expect(info.supportsMpp).toBe(false);
  });

  it("remembers a loaded mint as known within one runtime", async () => {
    const known = await runLinkshu(
      { bip39Seed: seed },
      Effect.gen(function* () {
        const mints = yield* Mints;
        yield* mints.info(mintUrl);
        return yield* mints.knownMints;
      }),
    );

    expect(known).toContain(mintUrl);
  });
});
