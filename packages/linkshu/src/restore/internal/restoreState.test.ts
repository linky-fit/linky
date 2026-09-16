import { Effect, Exit } from "effect";
import { CurrencyUnit, KeysetId, MintUrl } from "../../domain/primitives";
import { KeyValueStore } from "../../ports/KeyValueStore";
import { inMemoryKeyValueStore } from "../../ports/inMemoryKeyValueStore";
import { readSeenKeysets, rememberKeysets } from "./restoreState";

const mint = MintUrl.make("https://mint.example");
const otherMint = MintUrl.make("https://other.example");
const sat = CurrencyUnit.make("sat");
const keysetA = KeysetId.make("009a1f293253e41e");
const keysetB = KeysetId.make("009a1f293253e41f");

const run = <A, E>(program: Effect.Effect<A, E, KeyValueStore>) =>
  Effect.runPromiseExit(program.pipe(Effect.provide(inMemoryKeyValueStore)));

describe("seen keysets", () => {
  it("remembers keysets per mint and unit, and reads them back", async () => {
    const exit = await run(
      Effect.gen(function* () {
        const kv = yield* KeyValueStore;
        yield* rememberKeysets(kv, mint, sat, [keysetA, keysetB]);
        yield* rememberKeysets(kv, otherMint, sat, [keysetA]);
        // Re-remembering is a no-op, not a duplicate.
        yield* rememberKeysets(kv, mint, sat, [keysetA]);
        return {
          ours: [...(yield* readSeenKeysets(kv, mint, sat))].sort(),
          theirs: yield* readSeenKeysets(kv, otherMint, sat),
          otherUnit: yield* readSeenKeysets(kv, mint, CurrencyUnit.make("usd")),
        };
      }),
    );

    expect(exit).toEqual(
      Exit.succeed({
        ours: [keysetA, keysetB],
        theirs: [keysetA],
        otherUnit: [],
      }),
    );
  });
});
