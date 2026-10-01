import { Effect, Order } from "effect";
import { EnvelopeBusy, MintRejected } from "../../domain/errors";
import type { MintUnreachable } from "../../domain/errors";
import { UnixSeconds } from "../../domain/primitives";
import type { EnvelopeKey, MintUrl, TokenText } from "../../domain/primitives";
import type { InspectorService } from "../../inspector/Inspector";
import { withKeyLease } from "../../internal/lease";
import { insertOperation, patchOperation } from "../../internal/operations";
import {
  domainToNewProofs,
  insertProofs,
  setProofState,
  storedSecrets,
} from "../../internal/proofs";
import { nowSeconds } from "../../internal/time";
import { sat } from "../../internal/units";
import { classifyMintError } from "../../mint/internal/WalletInstances";
import type { LoadedWallet } from "../../mint/internal/WalletInstances";
import type { KeyValueStoreService } from "../../ports/KeyValueStore";
import { NewOperation } from "../../ports/OperationStore";
import type {
  OperationStatus,
  OperationStoreService,
  StoredOperation,
} from "../../ports/OperationStore";
import type {
  ProofState,
  ProofStoreService,
  StoredProof,
} from "../../ports/ProofStore";
import { decodeTokenText } from "../../token/codec";
import type { Proof } from "../../token/domain";
import { encodeProofs, toDomainProofs } from "../../token/internal/cashuProofs";
import { envelopeProbeOutputs } from "./derivation";

// The envelope bookkeeping the `Envelope` and `Melt` services share. An
// envelope is an `envelope` operation whose token text names its proofs;
// those proofs are `held` under it while it is open, so no other spend
// selects them.

export interface EnvelopeContext {
  readonly proofStore: ProofStoreService;
  readonly operationStore: OperationStoreService;
  readonly inspector: InspectorService;
}

export interface EnvelopeRefLike {
  readonly mint: MintUrl;
  readonly key: EnvelopeKey;
}

/** An envelope this device stores: its operation and its proofs, in slot order. */
export interface LocalEnvelope {
  readonly operation: StoredOperation;
  readonly tokenText: TokenText;
  readonly proofs: ReadonlyArray<Proof>;
}

const ENVELOPE_LOCK_KEY_PREFIX = "linkshu.envelopeLock.";

/** One context at a time opens, melts or releases a given envelope. */
export const withEnvelopeLease =
  (kv: KeyValueStoreService, ref: EnvelopeRefLike) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    withKeyLease(
      kv,
      ENVELOPE_LOCK_KEY_PREFIX +
        [ref.mint, ref.key].map(encodeURIComponent).join("."),
    )(effect).pipe(
      Effect.catchTag(
        "LeaseLockTimeout",
        () => new EnvelopeBusy({ mint: ref.mint, key: ref.key }),
      ),
    );

const envelopeOf = (operation: StoredOperation): LocalEnvelope | null => {
  if (operation.kind !== "envelope" || operation.tokenText === null)
    return null;
  const decoded = decodeTokenText(
    operation.tokenText,
    operation.keysetId === null ? [] : [operation.keysetId],
  );
  return decoded === null
    ? null
    : { operation, tokenText: operation.tokenText, proofs: decoded.proofs };
};

/** The stored envelope at `mint` whose proofs include `firstSecret`, its slot 0. */
const findEnvelope = (
  operations: ReadonlyArray<StoredOperation>,
  mint: MintUrl,
  firstSecret: string,
): LocalEnvelope | null =>
  operations
    .filter((operation) => operation.mint === mint)
    .flatMap((operation) => envelopeOf(operation) ?? [])
    .find((envelope) =>
      envelope.proofs.some((proof) => proof.secret === firstSecret),
    ) ?? null;

/** The stored rows of the envelope's proofs, whatever holds them now. */
export const rowsOf = (
  proofs: ReadonlyArray<StoredProof>,
  envelope: LocalEnvelope,
): ReadonlyArray<StoredProof> => {
  const secrets = new Set(envelope.proofs.map((proof) => proof.secret));
  return proofs.filter((proof) => secrets.has(proof.secret));
};

/** Rows held under the envelope itself: present only while it is open here. */
export const heldRowsOf = (
  proofs: ReadonlyArray<StoredProof>,
  envelope: LocalEnvelope,
): ReadonlyArray<StoredProof> =>
  rowsOf(proofs, envelope).filter(
    (proof) =>
      proof.state === "held" && proof.operationId === envelope.operation.id,
  );

/** The envelope went out as a token, so it is its recipient's money. */
export const isHandedOut = (
  envelope: LocalEnvelope,
  rows: ReadonlyArray<StoredProof>,
): boolean =>
  envelope.operation.status === "issued" ||
  rows.some((proof) => proof.state === "handedOut");

const rowStateOf = (status: OperationStatus): ProofState => {
  switch (status) {
    case "pending":
      return "held";
    case "issued":
      return "handedOut";
    default:
      return "spent";
  }
};

/**
 * Completes the envelope's proof rows after a crash between the operation
 * and its rows, or a partial sync: rows this store lacks are stored in the
 * state the operation implies, and `held` rows whose holder never synced go
 * back under the envelope. Other stored rows keep their state and holder.
 */
const reconcileRows = (
  ctx: EnvelopeContext,
  envelope: LocalEnvelope,
  reason: string,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const stored = rowsOf(yield* ctx.proofStore.loadAll, envelope);
    const known = storedSecrets(stored);
    yield* insertProofs(
      ctx,
      domainToNewProofs(
        envelope.proofs.filter((proof) => !known.has(proof.secret)),
        envelope.operation.mint,
        sat,
        rowStateOf(envelope.operation.status),
        envelope.operation.id,
      ),
      reason,
    );
    yield* setProofState(
      ctx,
      stored.filter(
        (proof) => proof.state === "held" && proof.operationId === null,
      ),
      "held",
      reason,
      envelope.operation.id,
    );
  });

/** The envelope this device stores for slot 0's secret, its rows complete. */
export const loadEnvelope = (
  ctx: EnvelopeContext,
  mint: MintUrl,
  firstSecret: string,
): Effect.Effect<LocalEnvelope | null> =>
  Effect.gen(function* () {
    const envelope = findEnvelope(
      yield* ctx.operationStore.loadAll,
      mint,
      firstSecret,
    );
    if (envelope !== null) {
      yield* reconcileRows(ctx, envelope, "envelope-reconcile");
    }
    return envelope;
  });

const malformed = (mint: MintUrl, detail: string): MintRejected =>
  new MintRejected({ mint, code: null, detail });

/**
 * What the mint signed for the key's slots (NUT-09), as proofs in slot
 * order; empty when the envelope was never funded.
 */
export const probeEnvelope = (
  wallet: LoadedWallet,
  seed: Uint8Array,
  ref: EnvelopeRefLike,
): Effect.Effect<ReadonlyArray<Proof>, MintUnreachable | MintRejected> =>
  Effect.gen(function* () {
    const outputs = envelopeProbeOutputs(seed, ref.key, wallet.keysetId);
    const restored = yield* Effect.tryPromise({
      try: () =>
        wallet.mint.restore({
          outputs: outputs.map((output) => output.blindedMessage),
        }),
      catch: (error) => classifyMintError(ref.mint, error),
    });
    const signatureOf = new Map(
      restored.outputs.map((output, index) => [
        output.B_,
        restored.signatures[index],
      ]),
    );
    const signed = yield* Effect.tryPromise({
      try: async () => {
        const proofs = [];
        for (const output of outputs) {
          const signature = signatureOf.get(output.blindedMessage.B_);
          if (signature === undefined) continue;
          const keyset = await wallet.keyChain.ensureKeysetKeys(signature.id);
          proofs.push(output.toProof(signature, keyset));
        }
        return proofs;
      },
      catch: (error) => classifyMintError(ref.mint, error),
    });
    const proofs = toDomainProofs(signed);
    return proofs === null
      ? yield* malformed(ref.mint, "mint returned malformed envelope proofs")
      : proofs;
  });

const bySlot = Order.mapInput(Order.Number, (proof: Proof) => proof.amount);

/**
 * Stores an envelope's proofs `held` under its operation. Both derive from
 * the proofs alone (one denomination per slot, so ascending amount is slot
 * order), so every device that stores an envelope lands on the same rows.
 */
export const storeEnvelope = (
  ctx: EnvelopeContext,
  mint: MintUrl,
  proofs: ReadonlyArray<Proof>,
  reason: string,
): Effect.Effect<LocalEnvelope, MintRejected> =>
  Effect.gen(function* () {
    const ordered = [...proofs].sort(bySlot);
    const encoded = encodeProofs({
      mint,
      unit: sat,
      memo: null,
      proofs: ordered,
    });
    const first = ordered[0];
    if (encoded === null || first === undefined) {
      return yield* malformed(mint, "envelope proofs could not be encoded");
    }
    const operation = yield* insertOperation(
      ctx,
      new NewOperation({
        kind: "envelope",
        status: "pending",
        mint,
        unit: sat,
        keysetId: first.id,
        amount: encoded.amount,
        feeReserve: null,
        inputsTotal: null,
        quoteId: null,
        invoice: null,
        sourceMint: null,
        counter: null,
        locked: null,
        expiresAt: null,
        createdAt: UnixSeconds.make(yield* nowSeconds),
        tokenText: encoded.tokenText,
        error: null,
      }),
      reason,
    );
    const envelope = {
      operation,
      tokenText: encoded.tokenText,
      proofs: ordered,
    };
    yield* reconcileRows(ctx, envelope, reason);
    return envelope;
  });

/** A melt by the fields that name the envelope it pays from, if any. */
export interface MeltOfEnvelope {
  readonly mint: MintUrl;
  readonly envelope: TokenText | null;
}

/**
 * The envelope a melt pays from, by the text on its record; stored here
 * first when its operation has not synced yet, decoded with the keysets of
 * the melt's input rows.
 */
export const envelopeOfMelt = (
  ctx: EnvelopeContext,
  melt: MeltOfEnvelope,
  inputs: ReadonlyArray<StoredProof>,
): Effect.Effect<LocalEnvelope | null, MintRejected> =>
  Effect.gen(function* () {
    const text = melt.envelope;
    if (text === null) return null;
    const stored = (yield* ctx.operationStore.loadAll).find(
      (operation) =>
        operation.kind === "envelope" && operation.tokenText === text,
    );
    const local = stored === undefined ? null : envelopeOf(stored);
    if (local !== null) return local;
    const decoded = decodeTokenText(
      text,
      inputs.map((proof) => proof.keysetId),
    );
    return decoded === null
      ? yield* malformed(melt.mint, "the melt's envelope text does not decode")
      : yield* storeEnvelope(ctx, melt.mint, decoded.proofs, "envelope-adopt");
  });

/**
 * Melt inputs from the melt's envelope go back `held` under it, so a melt
 * that did not pay leaves the envelope intact. Returns the other inputs.
 */
export const returnToEnvelope = (
  ctx: EnvelopeContext,
  melt: MeltOfEnvelope,
  inputs: ReadonlyArray<StoredProof>,
  reason: string,
): Effect.Effect<ReadonlyArray<StoredProof>, MintRejected> =>
  Effect.gen(function* () {
    const envelope = yield* envelopeOfMelt(ctx, melt, inputs);
    if (envelope === null) return inputs;
    const rows = rowsOf(inputs, envelope);
    yield* setProofState(ctx, rows, "held", reason, envelope.operation.id);
    return inputs.filter((proof) => !rows.includes(proof));
  });

/** An open envelope all of whose proofs are `spent` closes `done`. */
export const closeIfSpent = (
  ctx: EnvelopeContext,
  envelope: LocalEnvelope,
  reason: string,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const { status } = envelope.operation;
    const rows = rowsOf(yield* ctx.proofStore.loadAll, envelope);
    if (
      (status === "pending" || status === "issued") &&
      rows.length === envelope.proofs.length &&
      rows.every((proof) => proof.state === "spent")
    ) {
      yield* patchOperation(
        ctx,
        envelope.operation,
        { status: "done" },
        reason,
      );
    }
  });
