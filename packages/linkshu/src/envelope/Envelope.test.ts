import type {
  MeltQuoteBolt11Response,
  MeltQuoteState,
  OutputDataLike,
  ProofLike,
  SerializedBlindedSignature,
} from "@cashu/cashu-ts";
import {
  Amount as CashuAmount,
  createBlindSignature,
  createNewMintKeys,
  Keyset,
  MintOperationError,
  pointFromHex,
  serializeMintKeys,
} from "@cashu/cashu-ts";
import { Effect, Layer, Struct, TestContext } from "effect";
import { MintUnreachable } from "../domain/errors";
import {
  Amount,
  Bip39Seed,
  Bolt11Invoice,
  EnvelopeKey,
  MintUrl,
} from "../domain/primitives";
import { Melt } from "../melt/Melt";
import { WalletInstances } from "../mint/internal/WalletInstances";
import type { LoadedWallet } from "../mint/internal/WalletInstances";
import { CashuSeed } from "../ports/CashuSeed";
import { KeyValueStore } from "../ports/KeyValueStore";
import {
  NewOperation,
  OperationStore,
  operationKeyOf,
} from "../ports/OperationStore";
import type { StoredOperation } from "../ports/OperationStore";
import { NewProof, ProofStore } from "../ports/ProofStore";
import type { ProofState, StoredProof } from "../ports/ProofStore";
import { runOnTestClock } from "../testing/clock";
import {
  answerProofStates,
  fakeReceiveSwap,
  fakeWallet,
  proof,
} from "../testing/fakeWallet";
import { recordingInspector } from "../testing/inspector";
import { amountIn, seedProofs } from "../testing/inventory";
import { freshStorage } from "../testing/storage";
import type { Storage } from "../testing/storage";
import { EnvelopeMeltDraft, EnvelopeOpenDraft, EnvelopeRef } from "./domain";
import { Envelope } from "./Envelope";
import { withEnvelopeLease } from "./internal/envelopes";

const mint = MintUrl.make("https://mint.example");
const key = EnvelopeKey.make("recurring:order-1:0");
const ref = new EnvelopeRef({ mint, key });
const seed = Bip39Seed.make(new Uint8Array(64).fill(3));
const invoice = Bolt11Invoice.make("lnbc1envelope");

const mintKeys = createNewMintKeys(8, undefined, { versionByte: 0 });
const keyset = new Keyset(mintKeys.keysetId, "sat", true);
keyset.keys = serializeMintKeys(mintKeys.pubKeys);

const sumOf = (proofs: ReadonlyArray<ProofLike>): number =>
  proofs.reduce((sum, entry) => sum + Number(entry.amount), 0);

/**
 * A mint that really blind-signs, like nutshell: inputs are checked first,
 * then every output is signed at most once, and restore answers for the
 * outputs it signed.
 */
const makeFakeMint = () => {
  const signatures = new Map<string, SerializedBlindedSignature>();
  const spent = new Set<string>();
  const pending = new Set<string>();
  const sign = (output: OutputDataLike) => {
    const amount = output.blindedMessage.amount.toNumber();
    const privateKey = mintKeys.privKeys[amount];
    if (privateKey === undefined) throw new Error(`no key for ${amount}`);
    const signature: SerializedBlindedSignature = {
      id: mintKeys.keysetId,
      amount: CashuAmount.from(amount),
      C_: createBlindSignature(
        pointFromHex(output.blindedMessage.B_),
        privateKey,
        mintKeys.keysetId,
      ).C_.toHex(true),
    };
    signatures.set(output.blindedMessage.B_, signature);
    return output.toProof(signature, keyset);
  };
  const spend = (proofs: ReadonlyArray<ProofLike>) => {
    if (proofs.some((entry) => spent.has(entry.secret))) {
      throw new MintOperationError(11001, "proofs already spent");
    }
    for (const entry of proofs) spent.add(entry.secret);
  };
  /** What a melt quote check answers. */
  const quote: { state: MeltQuoteState } = { state: "PENDING" };
  return { signatures, spent, pending, quote, sign, spend };
};
type FakeMint = ReturnType<typeof makeFakeMint>;

interface DeviceArgs {
  readonly name: string;
  /** Restore answers as if nothing were signed: a probe that ran too early. */
  readonly blindProbe?: boolean;
  /** `lost`: the melt request never comes back, as if the network failed. */
  readonly meltState?: MeltQuoteState | "lost";
  readonly quoteAmount?: number;
  /** The mint signs the first swap, then the network fails until `reconnect`. */
  readonly loseSwapResponse?: boolean;
}

const quoteResponse = (
  amount: number,
  state: MeltQuoteState,
  request: string = invoice,
): MeltQuoteBolt11Response => ({
  quote: `quote-${request}`,
  amount: CashuAmount.from(amount),
  unit: "sat",
  state,
  expiry: Math.floor(Date.now() / 1000) + 600,
  request,
  fee_reserve: CashuAmount.from(2),
  payment_preimage: null,
});

const networkDown = () => new TypeError("network down");

const deviceWallet = (fakeMint: FakeMint, args: DeviceArgs) => {
  const calls = { swaps: 0, restores: 0 };
  const network = { online: true };
  let blindProbe = args.blindProbe === true;
  const wallet: LoadedWallet = fakeWallet({
    keysetId: mintKeys.keysetId,
    keyChain: {
      getKeysets: () => [],
      ensureKeysetKeys: () => Promise.resolve(keyset),
    },
    checkProofsStates: answerProofStates((secret) =>
      fakeMint.spent.has(secret)
        ? "SPENT"
        : fakeMint.pending.has(secret)
          ? "PENDING"
          : "UNSPENT",
    ),
    send: (amount, proofs, _config, outputConfig) =>
      Promise.resolve().then(() => {
        calls.swaps += 1;
        const fixed =
          outputConfig?.send.type === "custom" ? outputConfig.send.data : [];
        fakeMint.spend(proofs);
        if (
          fixed.some((output) =>
            fakeMint.signatures.has(output.blindedMessage.B_),
          )
        ) {
          for (const entry of proofs) fakeMint.spent.delete(entry.secret);
          blindProbe = false;
          throw new MintOperationError(11003, "outputs already signed");
        }
        const value = Number(amount);
        const change = sumOf(proofs) - value;
        const response = {
          send:
            fixed.length > 0
              ? fixed.map(fakeMint.sign)
              : [proof(value, `${args.name}-melt-input-${calls.swaps}`)],
          keep:
            change > 0
              ? [proof(change, `${args.name}-change-${calls.swaps}`)]
              : [],
        };
        if (args.loseSwapResponse === true && calls.swaps === 1) {
          network.online = false;
          throw networkDown();
        }
        return response;
      }),
    mint: {
      webSocketConnection: undefined,
      disconnectWebSocket: () => undefined,
      restore: ({ outputs }) => {
        calls.restores += 1;
        if (!network.online) return Promise.reject(networkDown());
        const signed = blindProbe
          ? []
          : outputs.flatMap((output) => {
              const signature = fakeMint.signatures.get(output.B_);
              return signature === undefined ? [] : [{ output, signature }];
            });
        return Promise.resolve({
          outputs: signed.map((entry) => entry.output),
          signatures: signed.map((entry) => entry.signature),
        });
      },
    },
    ...fakeReceiveSwap(
      (_token, counter) =>
        Promise.resolve([proof(15, `${args.name}-released-${counter}`)]),
      1,
    ),
    createMeltQuoteBolt11: (request) =>
      Promise.resolve(quoteResponse(args.quoteAmount ?? 8, "UNPAID", request)),
    checkMeltQuoteBolt11: () =>
      Promise.resolve(
        quoteResponse(args.quoteAmount ?? 8, fakeMint.quote.state),
      ),
    meltProofsBolt11: (quote, proofs) =>
      Promise.resolve().then(() => {
        const state = args.meltState ?? "PAID";
        if (state === "lost") throw networkDown();
        if (state === "PAID") fakeMint.spend(proofs);
        return {
          quote: quoteResponse(args.quoteAmount ?? 8, state, quote.request),
          change: [],
          outputData: [],
        };
      }),
  });
  return { wallet, calls, network };
};

const makeDevice = (
  fakeMint: FakeMint,
  args: DeviceArgs,
  storage: Storage = freshStorage(),
) => {
  const { wallet, calls, network } = deviceWallet(fakeMint, args);
  const inspector = recordingInspector();
  const layer = Layer.mergeAll(
    Envelope.DefaultWithoutDependencies,
    Melt.DefaultWithoutDependencies,
  ).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.succeed(
          WalletInstances,
          WalletInstances.make({
            get: (requested) =>
              requested === mint
                ? Effect.succeed(wallet)
                : new MintUnreachable({ mint: requested, detail: null }),
          }),
        ),
        Layer.succeed(KeyValueStore, storage.kv),
        Layer.succeed(ProofStore, storage.proofs),
        Layer.succeed(OperationStore, storage.operations),
        CashuSeed.fromBytes(seed),
        inspector.layer,
      ),
    ),
  );
  const run = <A, E>(
    program: Effect.Effect<
      A,
      E,
      Envelope | Melt | ProofStore | OperationStore | KeyValueStore
    >,
  ) => Effect.runPromise(program.pipe(Effect.provide(layer)));
  const fund = (sats: number) =>
    run(seedProofs(mint, [proof(sats, `${args.name}-source`)]));
  const open = (amount: number) =>
    run(
      Effect.flatMap(Envelope, (envelope) =>
        envelope.open(
          new EnvelopeOpenDraft({ mint, key, amount: Amount.make(amount) }),
        ),
      ),
    );
  const inventory = () =>
    run(
      Effect.all({
        proofs: Effect.flatMap(ProofStore, (store) => store.loadAll),
        operations: Effect.flatMap(OperationStore, (store) => store.loadAll),
      }),
    );
  const send = () =>
    run(Effect.flatMap(Envelope, (envelope) => envelope.send(ref)));
  const release = () =>
    run(Effect.flatMap(Envelope, (envelope) => envelope.release(ref)));
  const setProofs = (proofs: ReadonlyArray<StoredProof>, state: ProofState) =>
    run(
      Effect.flatMap(ProofStore, (store) =>
        Effect.forEach(proofs, (entry) => store.update(entry.id, { state })),
      ),
    );
  return {
    run,
    fund,
    open,
    send,
    release,
    setProofs,
    inventory,
    calls,
    reconnect: () => {
      network.online = true;
    },
    events: inspector.events,
  };
};

/** Stores rows and operations another device wrote, as a sync would. */
const syncInto = (
  device: ReturnType<typeof makeDevice>,
  synced: {
    readonly operations?: ReadonlyArray<NewOperation>;
    readonly proofs?: ReadonlyArray<StoredProof>;
  },
) =>
  device.run(
    Effect.gen(function* () {
      const operations = yield* OperationStore;
      yield* Effect.forEach(synced.operations ?? [], operations.insert);
      yield* (yield* ProofStore).insert(
        (synced.proofs ?? []).map(
          (entry) => new NewProof(Struct.omit(entry, "id", "createdAt")),
        ),
      );
    }),
  );

const asNew = (operation: StoredOperation) =>
  new NewOperation(Struct.omit(operation, "id"));

const stateOfSecret = (
  proofs: ReadonlyArray<{ secret: string; state: ProofState }>,
  secret: string,
) => proofs.find((entry) => entry.secret === secret)?.state;

const envelopeOperation = <O extends { readonly kind: string }>(
  operations: ReadonlyArray<O>,
) => operations.find((operation) => operation.kind === "envelope");

const heldOf = (proofs: ReadonlyArray<StoredProof>) =>
  proofs.filter((entry) => entry.state === "held");

const handedOutOf = (proofs: ReadonlyArray<StoredProof>) =>
  proofs.filter((entry) => entry.state === "handedOut");

const spentAt = (fakeMint: FakeMint, proofs: ReadonlyArray<StoredProof>) =>
  proofs.some((entry) => fakeMint.spent.has(entry.secret));

describe("Envelope.open", () => {
  it("funds the key's outputs, holds them under an envelope and books change and inputs", async () => {
    const device = makeDevice(makeFakeMint(), { name: "a" });
    await device.fund(32);

    const opened = await device.open(10);

    expect(opened).toMatchObject({ outcome: "created", amount: 10 });
    const { proofs, operations } = await device.inventory();
    expect(envelopeOperation(operations)).toMatchObject({
      id: opened.operationId,
      status: "pending",
      amount: 10,
    });
    expect(
      proofs
        .filter((entry) => entry.state === "held")
        .map((entry) => [entry.amount, entry.operationId]),
    ).toEqual([
      [2, opened.operationId],
      [8, opened.operationId],
    ]);
    expect(amountIn(proofs, "available")).toBe(22);
    expect(stateOfSecret(proofs, "a-source")).toBe("spent");
    expect(
      device.events.some(
        (event) =>
          event._tag === "OperationChanged" &&
          event.kind === "envelope" &&
          event.reason === "envelope",
      ),
    ).toBe(true);
  });

  it("adopts what another wallet with the seed funded, at its amount, without spending", async () => {
    const fakeMint = makeFakeMint();
    const first = makeDevice(fakeMint, { name: "a" });
    const second = makeDevice(fakeMint, { name: "b" });
    await first.fund(32);
    await second.fund(32);

    const created = await first.open(10);
    const adopted = await second.open(12);

    expect(adopted).toEqual({
      ...created,
      outcome: "adopted",
    });
    expect(second.calls.swaps).toBe(0);
    const { proofs } = await second.inventory();
    expect(amountIn(proofs, "held")).toBe(10);
    expect(amountIn(proofs, "available")).toBe(32);
  });

  it("adopts the envelope when another wallet funds it between the probe and the swap", async () => {
    const fakeMint = makeFakeMint();
    const first = makeDevice(fakeMint, { name: "a" });
    const second = makeDevice(fakeMint, { name: "b", blindProbe: true });
    await first.fund(32);
    await second.fund(32);
    await first.open(10);

    const raced = await second.open(10);

    expect(raced.outcome).toBe("adopted");
    // The collision on signed outputs ends the swap; no counter recovery.
    expect(second.calls.swaps).toBe(1);
    const { proofs } = await second.inventory();
    expect(stateOfSecret(proofs, "b-source")).toBe("available");
    expect(amountIn(proofs, "held")).toBe(10);
  });

  it("answers from the store once the envelope is held here", async () => {
    const device = makeDevice(makeFakeMint(), { name: "a" });
    await device.fund(32);
    const created = await device.open(10);
    const restores = device.calls.restores;

    expect(await device.open(10)).toEqual({ ...created, outcome: "adopted" });
    expect(device.calls.restores).toBe(restores);
  });

  it("adopts on the next open what a swap whose answer was lost funded", async () => {
    const device = makeDevice(makeFakeMint(), {
      name: "a",
      loseSwapResponse: true,
    });
    await device.fund(32);

    const lost = await device.run(
      Effect.flip(
        Effect.flatMap(Envelope, (envelope) =>
          envelope.open(
            new EnvelopeOpenDraft({ mint, key, amount: Amount.make(10) }),
          ),
        ),
      ),
    );
    expect(lost._tag).toBe("MintUnreachable");
    expect(amountIn((await device.inventory()).proofs, "held")).toBe(0);
    device.reconnect();

    expect(await device.open(10)).toMatchObject({
      outcome: "adopted",
      amount: 10,
    });
    expect(device.calls.swaps).toBe(1);
    expect(amountIn((await device.inventory()).proofs, "held")).toBe(10);
  });

  it("fails InsufficientFunds without touching the balance", async () => {
    const device = makeDevice(makeFakeMint(), { name: "a" });
    await device.fund(4);

    const error = await device.run(
      Effect.flip(
        Effect.flatMap(Envelope, (envelope) =>
          envelope.open(
            new EnvelopeOpenDraft({ mint, key, amount: Amount.make(10) }),
          ),
        ),
      ),
    );

    expect(error).toMatchObject({ _tag: "InsufficientFunds", required: 10 });
    expect(amountIn((await device.inventory()).proofs, "available")).toBe(4);
  });

  it("fails EnvelopeBusy while another context holds the envelope", async () => {
    const device = makeDevice(makeFakeMint(), { name: "a" });
    await device.fund(32);

    const error = await device.run(
      Effect.gen(function* () {
        yield* Effect.fork(
          withEnvelopeLease(yield* KeyValueStore, ref)(Effect.never),
        );
        return yield* runOnTestClock(
          Effect.flip(
            Effect.flatMap(Envelope, (envelope) =>
              envelope.open(
                new EnvelopeOpenDraft({ mint, key, amount: Amount.make(10) }),
              ),
            ),
          ),
          "5 seconds",
        );
      }).pipe(Effect.provide(TestContext.TestContext)),
    );

    expect(error).toMatchObject({ _tag: "EnvelopeBusy", mint, key });
    expect(device.calls.swaps).toBe(0);
  });
});

describe("Envelope.state", () => {
  const stateOf = (device: ReturnType<typeof makeDevice>) =>
    device.run(Effect.flatMap(Envelope, (envelope) => envelope.state(ref)));

  it("is absent for a key nobody funded", async () => {
    const device = makeDevice(makeFakeMint(), { name: "a" });

    expect(await stateOf(device)).toMatchObject({
      status: "absent",
      amount: 0,
      operationId: null,
    });
    expect((await device.inventory()).operations).toEqual([]);
  });

  it("adopts an unspent envelope another wallet funded", async () => {
    const fakeMint = makeFakeMint();
    const first = makeDevice(fakeMint, { name: "a" });
    await first.fund(32);
    const created = await first.open(10);

    const second = makeDevice(fakeMint, { name: "b" });
    expect(await stateOf(second)).toMatchObject({
      status: "unspent",
      amount: 10,
      operationId: created.operationId,
    });
    expect(amountIn((await second.inventory()).proofs, "held")).toBe(10);
  });

  it("closes the envelope once the mint reports it spent", async () => {
    const fakeMint = makeFakeMint();
    const device = makeDevice(fakeMint, { name: "a" });
    await device.fund(32);
    await device.open(10);
    const { proofs } = await device.inventory();
    for (const entry of proofs) {
      if (entry.state === "held") fakeMint.spent.add(entry.secret);
    }

    expect((await stateOf(device)).status).toBe("spent");
    const after = await device.inventory();
    expect(amountIn(after.proofs, "spent")).toBe(42);
    expect(envelopeOperation(after.operations)?.status).toBe("done");
  });

  it("reports pending and mixed envelopes without closing them", async () => {
    const fakeMint = makeFakeMint();
    const device = makeDevice(fakeMint, { name: "a" });
    await device.fund(32);
    await device.open(10);
    const [two, eight] = (await device.inventory()).proofs.filter(
      (entry) => entry.state === "held",
    );
    assert(two !== undefined && eight !== undefined);

    fakeMint.pending.add(two.secret);
    expect((await stateOf(device)).status).toBe("pending");
    fakeMint.pending.clear();
    fakeMint.spent.add(two.secret);
    expect((await stateOf(device)).status).toBe("mixed");
    const after = await device.inventory();
    expect(stateOfSecret(after.proofs, two.secret)).toBe("spent");
    expect(stateOfSecret(after.proofs, eight.secret)).toBe("held");
    expect(envelopeOperation(after.operations)?.status).toBe("pending");
  });
});

describe("Envelope.send", () => {
  const sendOf = (device: ReturnType<typeof makeDevice>) =>
    device.run(Effect.flatMap(Envelope, (envelope) => envelope.send(ref)));

  it("hands the proofs out as the same token on every device", async () => {
    const fakeMint = makeFakeMint();
    const first = makeDevice(fakeMint, { name: "a" });
    const second = makeDevice(fakeMint, { name: "b" });
    await first.fund(32);
    await first.open(10);
    await second.open(10);

    const token = await sendOf(first);

    expect(await sendOf(second)).toEqual(token);
    expect(await sendOf(first)).toEqual(token);
    const { proofs, operations } = await first.inventory();
    expect(amountIn(proofs, "handedOut")).toBe(10);
    expect(envelopeOperation(operations)?.status).toBe("issued");
  });

  it("fails EnvelopeNotFound for a key not opened here", async () => {
    const device = makeDevice(makeFakeMint(), { name: "a" });

    expect(
      await device.run(
        Effect.flip(Effect.flatMap(Envelope, (envelope) => envelope.send(ref))),
      ),
    ).toMatchObject({ _tag: "EnvelopeNotFound", mint, key });
  });

  it("resumes a send that crashed after handing out the proofs", async () => {
    const device = makeDevice(makeFakeMint(), { name: "a" });
    await device.fund(32);
    await device.open(10);
    const before = await device.inventory();
    await device.setProofs(heldOf(before.proofs), "handedOut");

    const token = await device.send();

    expect(token.tokenText).toBe(
      envelopeOperation(before.operations)?.tokenText,
    );
    const { proofs, operations } = await device.inventory();
    expect(amountIn(proofs, "handedOut")).toBe(10);
    expect(envelopeOperation(operations)?.status).toBe("issued");
  });

  it("hands out the rest when a sync left a pending operation over handed-out rows", async () => {
    const device = makeDevice(makeFakeMint(), { name: "a" });
    await device.fund(32);
    await device.open(10);
    const [two] = heldOf((await device.inventory()).proofs);
    assert(two !== undefined);
    await device.setProofs([two], "handedOut");

    await device.send();

    const { proofs, operations } = await device.inventory();
    expect(amountIn(proofs, "handedOut")).toBe(10);
    expect(envelopeOperation(operations)?.status).toBe("issued");
  });

  it("fails EnvelopeBusy while another context holds the envelope", async () => {
    const device = makeDevice(makeFakeMint(), { name: "a" });
    await device.fund(32);
    await device.open(10);

    const error = await device.run(
      Effect.gen(function* () {
        yield* Effect.fork(
          withEnvelopeLease(yield* KeyValueStore, ref)(Effect.never),
        );
        return yield* runOnTestClock(
          Effect.flip(
            Effect.flatMap(Envelope, (envelope) => envelope.send(ref)),
          ),
          "5 seconds",
        );
      }).pipe(Effect.provide(TestContext.TestContext)),
    );

    expect(error).toMatchObject({ _tag: "EnvelopeBusy", mint, key });
    expect(amountIn((await device.inventory()).proofs, "handedOut")).toBe(0);
  });
});

describe("Envelope.release", () => {
  const releaseOf = (device: ReturnType<typeof makeDevice>) =>
    device.run(Effect.flatMap(Envelope, (envelope) => envelope.release(ref)));

  it("swaps an unspent envelope back into the balance", async () => {
    const device = makeDevice(makeFakeMint(), { name: "a" });
    await device.fund(32);
    await device.open(16);

    expect(await releaseOf(device)).toMatchObject({ amount: 15 });
    const { proofs, operations } = await device.inventory();
    expect(amountIn(proofs, "held")).toBe(0);
    expect(amountIn(proofs, "available")).toBe(16 + 15);
    expect(envelopeOperation(operations)?.status).toBe("returned");
  });

  it("releases nothing for a key nobody funded", async () => {
    const device = makeDevice(makeFakeMint(), { name: "a" });

    expect(await releaseOf(device)).toMatchObject({ amount: 0 });
  });

  it("releases nothing from an envelope handed out as a token", async () => {
    const fakeMint = makeFakeMint();
    const device = makeDevice(fakeMint, { name: "a" });
    await device.fund(32);
    await device.open(16);
    await device.send();

    expect(await device.release()).toMatchObject({ amount: 0 });
    const { proofs, operations } = await device.inventory();
    expect(amountIn(proofs, "handedOut")).toBe(16);
    expect(spentAt(fakeMint, handedOutOf(proofs))).toBe(false);
    expect(envelopeOperation(operations)?.status).toBe("issued");
  });

  it("releases nothing when a proof is handed out under a pending operation", async () => {
    const fakeMint = makeFakeMint();
    const device = makeDevice(fakeMint, { name: "a" });
    await device.fund(32);
    await device.open(10);
    const held = heldOf((await device.inventory()).proofs);
    await device.setProofs(held.slice(0, 1), "handedOut");

    expect(await device.release()).toMatchObject({ amount: 0 });
    expect(spentAt(fakeMint, held)).toBe(false);
  });

  it("never invalidates a token sent while it runs", async () => {
    const fakeMint = makeFakeMint();
    const device = makeDevice(fakeMint, { name: "a" });
    await device.fund(32);
    await device.open(16);

    const [sent, released] = await Promise.all([
      device.run(
        Effect.either(
          Effect.flatMap(Envelope, (envelope) => envelope.send(ref)),
        ),
      ),
      device.release(),
    ]);

    const tokenOut = sent._tag === "Right";
    expect(released.amount === 0).toBe(tokenOut);
    const { proofs } = await device.inventory();
    expect(amountIn(proofs, "handedOut")).toBe(tokenOut ? 16 : 0);
    expect(spentAt(fakeMint, handedOutOf(proofs))).toBe(false);
  });
});

describe("an envelope operation stored without its proof rows", () => {
  it("gets its rows back from the operation's text, so open, state and send work", async () => {
    const fakeMint = makeFakeMint();
    const first = makeDevice(fakeMint, { name: "a" });
    await first.fund(32);
    const created = await first.open(10);
    const second = makeDevice(fakeMint, { name: "b" });
    await syncInto(second, {
      operations: (await first.inventory()).operations
        .filter((operation) => operation.kind === "envelope")
        .map(asNew),
    });

    expect(await second.open(10)).toMatchObject({
      outcome: "adopted",
      operationId: created.operationId,
    });
    expect(second.calls.restores).toBe(0);
    expect(amountIn((await second.inventory()).proofs, "held")).toBe(10);
    expect(
      (
        await second.run(
          Effect.flatMap(Envelope, (envelope) => envelope.state(ref)),
        )
      ).status,
    ).toBe("unspent");
    expect(await second.send()).toEqual(await first.send());
  });

  it("keeps the state of the rows it already stores", async () => {
    const fakeMint = makeFakeMint();
    const first = makeDevice(fakeMint, { name: "a" });
    await first.fund(32);
    await first.open(10);
    const pending = await first.inventory();
    await first.send();
    const [two, eight] = handedOutOf((await first.inventory()).proofs);
    assert(two !== undefined && eight !== undefined);
    const second = makeDevice(fakeMint, { name: "b" });
    await syncInto(second, {
      operations: pending.operations
        .filter((operation) => operation.kind === "envelope")
        .map(asNew),
      proofs: [two],
    });

    await second.open(10);

    const { proofs } = await second.inventory();
    expect(stateOfSecret(proofs, two.secret)).toBe("handedOut");
    expect(stateOfSecret(proofs, eight.secret)).toBe("held");
    expect(await second.release()).toMatchObject({ amount: 0 });
  });

  it("puts rows whose holder never synced back under the envelope, so it can be sent", async () => {
    const fakeMint = makeFakeMint();
    const first = makeDevice(fakeMint, { name: "a" });
    await first.fund(32);
    const created = await first.open(10);
    const { proofs, operations } = await first.inventory();
    const second = makeDevice(fakeMint, { name: "b" });
    await syncInto(second, {
      operations: operations
        .filter((operation) => operation.kind === "envelope")
        .map(asNew),
      proofs: heldOf(proofs).map((entry) => ({ ...entry, operationId: null })),
    });

    expect(await second.open(10)).toMatchObject({ outcome: "adopted" });

    expect(
      heldOf((await second.inventory()).proofs).map(
        (entry) => entry.operationId,
      ),
    ).toEqual([created.operationId, created.operationId]);
    expect(await second.send()).toEqual(await first.send());
  });
});

describe("Melt.meltEnvelope", () => {
  const meltOf = (
    device: ReturnType<typeof makeDevice>,
    payee: Bolt11Invoice = invoice,
  ) =>
    device.run(
      Effect.either(
        Effect.flatMap(Melt, (melt) =>
          melt.meltEnvelope(
            new EnvelopeMeltDraft({ mint, key, invoice: payee }),
          ),
        ),
      ),
    );
  const resumeOn = (device: ReturnType<typeof makeDevice>) =>
    device.run(Effect.flatMap(Melt, (service) => service.resumePending));

  it("pays with the envelope, taking only the fee reserve from the balance", async () => {
    const device = makeDevice(makeFakeMint(), { name: "a" });
    await device.fund(32);
    await device.open(8);

    const paid = await meltOf(device);

    assert(paid._tag === "Right");
    expect(paid.right).toMatchObject({ paidAmount: 8, feePaid: 2 });
    const { proofs, operations } = await device.inventory();
    expect(amountIn(proofs, "available")).toBe(32 - 8 - 2);
    expect(amountIn(proofs, "held")).toBe(0);
    expect(envelopeOperation(operations)?.status).toBe("done");
  });

  it("leaves the envelope's proofs in the envelope when the payment fails", async () => {
    const device = makeDevice(makeFakeMint(), {
      name: "a",
      meltState: "UNPAID",
    });
    await device.fund(32);
    const opened = await device.open(8);

    const unpaid = await meltOf(device);

    assert(unpaid._tag === "Left");
    expect(unpaid.left._tag).toBe("PaymentFailed");
    const { proofs, operations } = await device.inventory();
    expect(
      proofs
        .filter((entry) => entry.state === "held")
        .map((entry) => entry.operationId),
    ).toEqual([opened.operationId]);
    expect(amountIn(proofs, "available")).toBe(32 - 8);
    expect(envelopeOperation(operations)?.status).toBe("pending");
  });

  it("refuses an invoice for another amount before anything moves", async () => {
    const device = makeDevice(makeFakeMint(), { name: "a", quoteAmount: 9 });
    await device.fund(32);
    await device.open(8);
    const before = await device.inventory();

    const mismatch = await meltOf(device);

    assert(mismatch._tag === "Left");
    expect(mismatch.left._tag).toBe("PaymentFailed");
    expect((await device.inventory()).proofs).toEqual(before.proofs);
  });

  it("puts a failed melt's envelope proofs back on a device the envelope has not synced to", async () => {
    const fakeMint = makeFakeMint();
    const first = makeDevice(fakeMint, { name: "a", meltState: "lost" });
    await first.fund(32);
    const opened = await first.open(8);
    const lost = await meltOf(first);
    assert(lost._tag === "Left");
    expect(lost.left._tag).toBe("PaymentPending");
    const { proofs, operations } = await first.inventory();
    const melt = operations.find((operation) => operation.kind === "melt");
    assert(melt !== undefined);
    expect(melt.tokenText).toBe(envelopeOperation(operations)?.tokenText);
    // The text names the envelope; the quote still keys the melt.
    expect(operationKeyOf(melt)).toBe(
      operationKeyOf({ ...melt, tokenText: null }),
    );
    const second = makeDevice(fakeMint, { name: "b" });
    await syncInto(second, {
      operations: [asNew(melt)],
      proofs: proofs.filter((entry) => entry.operationId === melt.id),
    });
    fakeMint.quote.state = "UNPAID";

    const results = await resumeOn(second);

    expect(results.map((result) => result.status)).toEqual(["unpaid"]);
    const after = await second.inventory();
    expect(envelopeOperation(after.operations)).toMatchObject({
      id: opened.operationId,
      status: "pending",
    });
    expect(heldOf(after.proofs).map((entry) => entry.operationId)).toEqual([
      opened.operationId,
    ]);
    expect(amountIn(after.proofs, "held")).toBe(8);
    // Only the fee reserve came from the balance.
    expect(amountIn(after.proofs, "available")).toBe(2);
  });

  it("returns inputs that sync in after their unpaid melt closed: the envelope's to it, the rest to the balance", async () => {
    const fakeMint = makeFakeMint();
    const first = makeDevice(fakeMint, { name: "a", meltState: "lost" });
    await first.fund(32);
    const opened = await first.open(8);
    await meltOf(first);
    const { proofs, operations } = await first.inventory();
    const melt = operations.find((operation) => operation.kind === "melt");
    assert(melt !== undefined);
    const second = makeDevice(fakeMint, { name: "b" });
    await syncInto(second, { operations: [asNew(melt)] });
    fakeMint.quote.state = "UNPAID";
    expect((await resumeOn(second)).map((result) => result.status)).toEqual([
      "unpaid",
    ]);

    await syncInto(second, {
      proofs: proofs.filter((entry) => entry.operationId === melt.id),
    });
    expect(await resumeOn(second)).toEqual([]);

    const after = await second.inventory();
    expect(heldOf(after.proofs).map((entry) => entry.operationId)).toEqual([
      opened.operationId,
    ]);
    expect(amountIn(after.proofs, "held")).toBe(8);
    expect(amountIn(after.proofs, "available")).toBe(2);
  });

  it("marks inputs that sync in after their paid melt closed spent", async () => {
    const fakeMint = makeFakeMint();
    const first = makeDevice(fakeMint, { name: "a" });
    await first.fund(32);
    await first.open(8);
    const melting = await first.inventory();
    await meltOf(first);
    const { operations } = await first.inventory();
    const melt = operations.find((operation) => operation.kind === "melt");
    assert(melt !== undefined && melt.status === "paid");
    const second = makeDevice(fakeMint, { name: "b" });
    await syncInto(second, { operations: [asNew(melt)] });
    await syncInto(second, {
      proofs: melting.proofs
        .filter((entry) => entry.state === "held")
        .map((entry) => ({ ...entry, operationId: melt.id })),
    });

    await resumeOn(second);

    const after = await second.inventory();
    expect(amountIn(after.proofs, "held")).toBe(0);
    expect(amountIn(after.proofs, "spent")).toBe(8);
  });

  it("puts the envelope back on the wallet whose melt lost the race for it", async () => {
    const fakeMint = makeFakeMint();
    const winner = makeDevice(fakeMint, { name: "a" });
    const loser = makeDevice(fakeMint, { name: "b" });
    await winner.fund(32);
    await loser.fund(32);
    const opened = await winner.open(8);
    await loser.open(8);

    const paid = await meltOf(winner);
    const rejected = await meltOf(loser, Bolt11Invoice.make("lnbc1other"));

    assert(paid._tag === "Right");
    assert(rejected._tag === "Left");
    expect(rejected.left).toMatchObject({ _tag: "MintRejected", code: 11001 });
    const { proofs } = await loser.inventory();
    expect(heldOf(proofs).map((entry) => entry.operationId)).toEqual([
      opened.operationId,
    ]);
    expect(amountIn(proofs, "held")).toBe(8);
    // Only the fee reserve came from the balance, and it is back.
    expect(amountIn(proofs, "available")).toBe(32);
    expect(
      (
        await loser.run(
          Effect.flatMap(Envelope, (envelope) => envelope.state(ref)),
        )
      ).status,
    ).toBe("spent");
    expect(amountIn((await loser.inventory()).proofs, "held")).toBe(0);
  });

  it("fails EnvelopeNotFound for an envelope already handed out", async () => {
    const device = makeDevice(makeFakeMint(), { name: "a" });
    await device.fund(32);
    await device.open(8);
    await device.run(
      Effect.flatMap(Envelope, (envelope) => envelope.send(ref)),
    );

    const sent = await meltOf(device);

    assert(sent._tag === "Left");
    expect(sent.left._tag).toBe("EnvelopeNotFound");
  });
});
