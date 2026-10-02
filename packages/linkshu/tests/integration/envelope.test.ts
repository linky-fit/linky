import { Effect } from "effect";
import {
  Amount,
  Envelope,
  EnvelopeKey,
  EnvelopeMeltDraft,
  EnvelopeOpenDraft,
  EnvelopeRef,
  Melt,
  ProofStore,
  Receive,
  ReceiveDraft,
  runLinkshu,
} from "../../src";
import type { Bip39Seed } from "../../src";
import { amountIn } from "../../src/testing/inventory";
import {
  availableTotalOf,
  claimExternally,
  durableStorage,
  fundToken,
  invoiceFor,
  mintUrl,
  randomSeed,
} from "./helpers";

const freshKey = () => EnvelopeKey.make(`test:${crypto.randomUUID()}`);

/** One device: its own stores, the shared seed, funded with `sats`. */
const device = async (seed: Bip39Seed, sats: number) => {
  const storage = durableStorage();
  const run = <A, E>(
    program: Effect.Effect<A, E, Envelope | Melt | Receive | ProofStore>,
  ) => runLinkshu({ bip39Seed: seed, ...storage.layers }, program);
  const text = await fundToken(sats);
  await run(
    Effect.flatMap(Receive, (receive) =>
      receive.receive(new ReceiveDraft({ text })),
    ),
  );
  return {
    open: (key: EnvelopeKey, amount: number) =>
      run(
        Effect.flatMap(Envelope, (envelope) =>
          envelope.open(
            new EnvelopeOpenDraft({
              mint: mintUrl,
              key,
              amount: Amount.make(amount),
            }),
          ),
        ),
      ),
    state: (key: EnvelopeKey) =>
      run(
        Effect.flatMap(Envelope, (envelope) =>
          envelope.state(new EnvelopeRef({ mint: mintUrl, key })),
        ),
      ),
    send: (key: EnvelopeKey) =>
      run(
        Effect.flatMap(Envelope, (envelope) =>
          envelope.send(new EnvelopeRef({ mint: mintUrl, key })),
        ),
      ),
    release: (key: EnvelopeKey) =>
      run(
        Effect.flatMap(Envelope, (envelope) =>
          envelope.release(new EnvelopeRef({ mint: mintUrl, key })),
        ),
      ),
    meltEnvelope: (key: EnvelopeKey, invoice: EnvelopeMeltDraft["invoice"]) =>
      run(
        Effect.flatMap(Melt, (melt) =>
          melt.meltEnvelope(
            new EnvelopeMeltDraft({ mint: mintUrl, key, invoice }),
          ),
        ),
      ),
    proofs: () => run(Effect.flatMap(ProofStore, (store) => store.loadAll)),
  };
};

describe("envelopes against the local mint", () => {
  it("funds a key once: the second wallet with the seed adopts it, whatever amount it asks for", async () => {
    const seed = randomSeed();
    const first = await device(seed, 40);
    const second = await device(seed, 40);
    const key = freshKey();

    const created = await first.open(key, 10);
    const adopted = await second.open(key, 12);

    expect(created.outcome).toBe("created");
    expect(adopted).toMatchObject({
      outcome: "adopted",
      operationId: created.operationId,
      amount: 10,
    });
    // The second wallet's balance funded nothing.
    expect(amountIn(await second.proofs(), "held")).toBe(10);
    expect(await second.state(key)).toMatchObject({
      status: "unspent",
      amount: 10,
    });
    const firstToken = await first.send(key);
    const secondToken = await second.send(key);
    expect(secondToken.tokenText).toBe(firstToken.tokenText);
    await claimExternally(firstToken.tokenText);
    expect((await first.state(key)).status).toBe("spent");
  });

  it("lets one of two wallets opening a key at once fund it", async () => {
    const seed = randomSeed();
    const first = await device(seed, 40);
    const second = await device(seed, 40);
    const key = freshKey();

    const outcomes = await Promise.all([
      first.open(key, 9),
      second.open(key, 9),
    ]);

    expect(outcomes.map((opened) => opened.outcome).sort()).toEqual([
      "adopted",
      "created",
    ]);
  });

  it("pays an invoice from the envelope", async () => {
    const wallet = await device(randomSeed(), 40);
    const key = freshKey();
    await wallet.open(key, 8);

    const receipt = await wallet.meltEnvelope(key, await invoiceFor(8));

    expect(receipt.paidAmount).toBe(8);
    expect((await wallet.state(key)).status).toBe("spent");
    expect(amountIn(await wallet.proofs(), "held")).toBe(0);
  });

  it("puts the envelope back on the wallet whose melt for another invoice lost", async () => {
    const seed = randomSeed();
    const winner = await device(seed, 40);
    const loser = await device(seed, 40);
    const key = freshKey();
    const created = await winner.open(key, 8);
    await loser.open(key, 8);
    const before = availableTotalOf(await loser.proofs());

    await winner.meltEnvelope(key, await invoiceFor(8));
    await expect(
      loser.meltEnvelope(key, await invoiceFor(8)),
    ).rejects.toThrow();

    const proofs = await loser.proofs();
    const held = proofs.filter((proof) => proof.state === "held");
    expect(
      held.every((proof) => proof.operationId === created.operationId),
    ).toBe(true);
    expect(amountIn(proofs, "held")).toBe(8);
    // Only the fee reserve's swap fee left the balance.
    expect(before - availableTotalOf(proofs)).toBeLessThanOrEqual(2);
    expect((await loser.state(key)).status).toBe("spent");
    expect(amountIn(await loser.proofs(), "held")).toBe(0);
  });

  it("releases an unspent envelope back into the balance", async () => {
    const wallet = await device(randomSeed(), 40);
    const key = freshKey();
    await wallet.open(key, 16);

    const released = await wallet.release(key);

    // 16 sats in 1 proof; the mint keeps its 1 sat input fee.
    expect(released.amount).toBe(15);
    expect((await wallet.state(key)).status).toBe("spent");
    expect(await wallet.open(key, 16)).toMatchObject({ outcome: "adopted" });
  });

  it("releases nothing from a sent envelope, so its recipient can still claim it", async () => {
    const wallet = await device(randomSeed(), 40);
    const key = freshKey();
    await wallet.open(key, 16);
    const token = await wallet.send(key);

    expect((await wallet.release(key)).amount).toBe(0);
    await claimExternally(token.tokenText);
    expect((await wallet.state(key)).status).toBe("spent");
  });
});
