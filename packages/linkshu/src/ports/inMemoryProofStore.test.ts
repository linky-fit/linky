import { Effect } from "effect";
import { TestClock } from "effect/testing";
import {
  Amount,
  CurrencyUnit,
  KeysetId,
  MintUrl,
  OperationId,
} from "../domain/primitives";
import { makeInMemoryProofStore } from "./inMemoryProofStore";
import { NewProof } from "./ProofStore";
import type { ProofState } from "./ProofStore";

const send = OperationId.make("send-1");

const proof = (
  secret: string,
  state: ProofState,
  keysetId = "00aa",
  operationId: OperationId | null = null,
) =>
  new NewProof({
    mint: MintUrl.make(`https://${secret}.example`),
    unit: CurrencyUnit.make("sat"),
    keysetId: KeysetId.make(keysetId),
    amount: Amount.make(1),
    secret,
    C: "02ab",
    dleq: null,
    state,
    operationId,
  });

const secretsOf = (proofs: ReadonlyArray<{ readonly secret: string }>) =>
  proofs.map((stored) => stored.secret).sort();

describe("inMemoryProofStore reads", () => {
  it("serves the working set, lookups in any state and the oldest proof per keyset", async () => {
    const store = makeInMemoryProofStore();
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(1_700_000_000_000);
        yield* store.insert([proof("old", "spent", "00aa", send)]);
        yield* TestClock.adjust("2 seconds");
        yield* store.insert([
          proof("out", "handedOut", "00aa", send),
          proof("free", "available", "00bb"),
        ]);

        expect(secretsOf(yield* store.loadUnspent)).toEqual(["free", "out"]);
        expect(
          secretsOf(yield* store.findBySecrets(["old", "free", "unknown"])),
        ).toEqual(["free", "old"]);
        expect(secretsOf(yield* store.findByOperation(send))).toEqual([
          "old",
          "out",
        ]);
        expect(
          secretsOf(
            yield* store.findOldestByKeysets(
              ["00aa", "00cc"].map((id) => KeysetId.make(id)),
            ),
          ),
        ).toEqual(["old"]);
      }).pipe(Effect.provide(TestClock.layer())),
    );
  });
});
