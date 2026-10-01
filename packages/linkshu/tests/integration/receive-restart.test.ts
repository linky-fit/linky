import { getDecodedToken } from "@cashu/cashu-ts";
import { Deferred, Effect, Either, Fiber, Layer, ManagedRuntime } from "effect";
import {
  linkshuServices,
  OperationStore,
  ProofStore,
  Receive,
  ReceiveDraft,
  runLinkshu,
  Tokens,
} from "../../src";
import {
  durableStorage,
  fundToken,
  loadMintWallet,
  randomSeed,
} from "./helpers";

const receiveText = (text: string) =>
  Effect.flatMap(Receive, (receive) =>
    receive.receive(new ReceiveDraft({ text })),
  );

type Stop =
  | "before swap"
  | "before storing proofs"
  | "before closing operation"
  | "before returning receipt";

/**
 * Starts receiving `text` over shared stores, stops the runtime at `stop`
 * the way a reload would, and leaves the stores as the next runtime finds them.
 */
const interruptReceive = async (
  text: string,
  storage: ReturnType<typeof durableStorage>,
  config: Parameters<typeof linkshuServices>[0],
  stop: Stop,
) => {
  const reached = Effect.runSync(Deferred.make<void>());
  const pause = Deferred.succeed(reached, undefined).pipe(
    Effect.zipRight(Effect.never),
  );
  const runtime = ManagedRuntime.make(
    linkshuServices({
      ...config,
      operationStore: Layer.succeed(OperationStore, {
        ...storage.operations,
        insert: (operation) =>
          storage.operations
            .insert(operation)
            .pipe(
              Effect.tap(() => (stop === "before swap" ? pause : Effect.void)),
            ),
        update: (id, patch) => {
          const update = storage.operations.update(id, patch);
          if (patch.status !== "done") return update;
          if (stop === "before closing operation")
            return pause.pipe(Effect.zipRight(update));
          if (stop === "before returning receipt")
            return update.pipe(Effect.zipRight(pause));
          return update;
        },
      }),
      proofStore: Layer.succeed(ProofStore, {
        ...storage.proofs,
        insert: (proofs) =>
          stop === "before storing proofs"
            ? pause.pipe(Effect.zipRight(storage.proofs.insert(proofs)))
            : storage.proofs.insert(proofs),
      }),
    }),
  );
  const fiber = runtime.runFork(receiveText(text));
  try {
    await Effect.runPromise(
      Deferred.await(reached).pipe(Effect.timeout("10 seconds")),
    );
  } finally {
    await Effect.runPromise(Fiber.interrupt(fiber));
    await runtime.dispose();
  }
};

describe("receive interrupted by a reload, against the local mint", () => {
  it.each([
    "before swap",
    "before storing proofs",
    "before closing operation",
  ] as const)(
    "resumes when the token is received again after a stop %s",
    async (stop) => {
      const text = await fundToken(32);
      const storage = durableStorage();
      const config = { bip39Seed: randomSeed(), ...storage.layers };
      await interruptReceive(text, storage, config, stop);

      const restarted = await runLinkshu(
        config,
        Effect.gen(function* () {
          const tokens = yield* Tokens;
          const retry = yield* Effect.either(receiveText(text));
          return {
            retry,
            transfers: yield* tokens.transfers,
            balances: yield* tokens.balances,
          };
        }),
      );
      const [transfer] = restarted.transfers;
      assert(transfer !== undefined);
      expect(restarted.transfers).toHaveLength(1);
      expect(transfer.status).toBe("done");
      assert(Either.isRight(restarted.retry));
      // 32 sat in, the mint keeps a 1 sat input fee.
      expect(restarted.retry.right).toMatchObject({
        operationId: transfer.id,
        amount: 31,
      });
      expect(restarted.balances.total).toBe(31);

      const mintWallet = await loadMintWallet();
      const inputStates = await mintWallet.checkProofsStates(
        getDecodedToken(text, [mintWallet.keysetId]).proofs,
      );
      expect(inputStates.every((state) => state.state === "SPENT")).toBe(true);
    },
  );

  it("still refuses the text of a receive that finished before the stop", async () => {
    const text = await fundToken(32);
    const storage = durableStorage();
    const config = { bip39Seed: randomSeed(), ...storage.layers };
    await interruptReceive(text, storage, config, "before returning receipt");

    const restarted = await runLinkshu(
      config,
      Effect.gen(function* () {
        const tokens = yield* Tokens;
        const retry = yield* Effect.either(receiveText(text));
        return {
          retry,
          transfers: yield* tokens.transfers,
          balances: yield* tokens.balances,
        };
      }),
    );
    const [transfer] = restarted.transfers;
    assert(transfer !== undefined);
    expect(transfer.status).toBe("done");
    assert(Either.isLeft(restarted.retry));
    expect(restarted.retry.left).toMatchObject({
      _tag: "TokenAlreadyKnown",
      operationId: transfer.id,
    });
    expect(restarted.balances.total).toBe(31);
  });
});
