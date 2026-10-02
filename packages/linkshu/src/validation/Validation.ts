import { Effect } from "effect";
import { OperationNotFound } from "../domain/errors";
import type { CurrencyUnit, MintUrl, OperationId } from "../domain/primitives";
import { Inspector } from "../inspector/Inspector";
import { inspectOperation, patchOperation } from "../internal/operations";
import { amountOf, setProofState, toDomainProof } from "../internal/proofs";
import {
  answerAt,
  checkProofStates,
  spentSecrets,
} from "../internal/proofStates";
import type { ProofStateEntry } from "../internal/proofStates";
import { WalletInstances } from "../mint/internal/WalletInstances";
import { OperationStore } from "../ports/OperationStore";
import type { StoredOperation } from "../ports/OperationStore";
import { ProofStore } from "../ports/ProofStore";
import type { StoredProof } from "../ports/ProofStore";
import { decodeTokenText } from "../token/codec";
import {
  ClaimedTransferReport,
  IssuedClaimReport,
  ProofStateSnapshot,
  SpentProofReport,
  TransferCheckResult,
  ValidationReport,
} from "./domain";

/** Proofs that share a mint and unit, and therefore one checkstate call. */
interface MintGroup {
  readonly mint: MintUrl;
  readonly unit: CurrencyUnit;
  readonly proofs: ReadonlyArray<StoredProof>;
}

const groupByMint = (
  proofs: ReadonlyArray<StoredProof>,
): ReadonlyArray<MintGroup> => {
  const groups = new Map<string, MintGroup & { proofs: StoredProof[] }>();
  for (const proof of proofs) {
    const key = `${proof.mint}|${proof.unit}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { mint: proof.mint, unit: proof.unit, proofs: [proof] });
    } else {
      group.proofs.push(proof);
    }
  }
  return [...groups.values()];
};

/** v4 text with short keyset ids needs the mint's list; try both ways. */
const decodeWithKeysets = (text: string, keysetIds: readonly string[]) =>
  decodeTokenText(text, keysetIds) ?? decodeTokenText(text);

/**
 * NUT-07 proof-state validation of the inventory. One batched checkstate
 * call per mint+unit group; per proof, `SPENT` is persisted as the terminal
 * state, any other answer changes nothing — a missing answer is never a
 * guess. Mint unavailability is data in the reports, never a failure of the
 * operation.
 */
export class Validation extends Effect.Service<Validation>()(
  "linkshu/Validation",
  {
    dependencies: [WalletInstances.Default],
    effect: Effect.gen(function* () {
      const proofStore = yield* ProofStore;
      const operationStore = yield* OperationStore;
      const instances = yield* WalletInstances;
      const inspector = yield* Inspector.orNoop;
      const ctx = { proofStore, operationStore, inspector };

      /**
       * One mint, one checkstate call. `null` means the mint gave no usable
       * answer (unreachable, or it rejected the query) — that is information
       * we do not have, never information that proofs are spent.
       */
      const askMint = (
        group: MintGroup,
      ): Effect.Effect<ReadonlyArray<ProofStateEntry> | null> =>
        Effect.gen(function* () {
          const wallet = yield* instances.get(group.mint, group.unit);
          return yield* checkProofStates(
            wallet,
            group.mint,
            group.proofs.map(toDomainProof),
          );
        }).pipe(Effect.catchAll(() => Effect.succeed(null)));

      /** Persists the spent proofs of one mint answer and returns them. */
      const applyAnswer = (
        group: MintGroup,
        states: ReadonlyArray<ProofStateEntry>,
        reason: string,
      ): Effect.Effect<ReadonlyArray<StoredProof>> =>
        Effect.gen(function* () {
          const spentSet = spentSecrets(
            group.proofs.map(toDomainProof),
            states,
          );
          const spent = group.proofs.filter((proof) =>
            spentSet.has(proof.secret),
          );
          // Spent proofs keep their operation link: which send handed them
          // out is history the transfer still reads.
          yield* setProofState(ctx, spent, "spent", reason);
          return spent;
        });

      /**
       * Checks the balance: every `available` proof. A `held` proof belongs
       * to its holder's resumer even while its holder has not synced here;
       * handed-out proofs belong to `checkIssued`.
       */
      const checkAll: Effect.Effect<ValidationReport> = Effect.gen(
        function* () {
          const proofs = (yield* proofStore.loadAll).filter(
            (proof) => proof.state === "available",
          );
          const markedSpent: SpentProofReport[] = [];
          const unavailableMints: MintUrl[] = [];
          let checkedProofs = 0;
          for (const group of groupByMint(proofs)) {
            const states = yield* askMint(group);
            if (states === null) {
              unavailableMints.push(group.mint);
              continue;
            }
            checkedProofs += Math.min(states.length, group.proofs.length);
            const spent = yield* applyAnswer(group, states, "validation");
            markedSpent.push(
              ...spent.map(
                (proof) =>
                  new SpentProofReport({
                    proofId: proof.id,
                    amount: proof.amount,
                  }),
              ),
            );
          }
          return new ValidationReport({
            checkedProofs,
            markedSpent,
            unavailableMints,
          });
        },
      ).pipe(inspectOperation(inspector, "validation.checkAll", {}));

      const handedOutOf = (
        proofs: ReadonlyArray<StoredProof>,
        operation: StoredOperation,
      ): ReadonlyArray<StoredProof> =>
        proofs.filter(
          (proof) =>
            proof.operationId === operation.id &&
            (proof.state === "handedOut" || proof.state === "externalized"),
        );

      /** Transfers whose handed-out proofs are all spent are claimed. */
      const closeClaimed = (
        operations: ReadonlyArray<StoredOperation>,
        proofsBefore: ReadonlyArray<StoredProof>,
        spent: ReadonlyArray<StoredProof>,
      ): Effect.Effect<ReadonlyArray<ClaimedTransferReport>> =>
        Effect.gen(function* () {
          const spentIds = new Set(spent.map((proof) => proof.id));
          const claimed: ClaimedTransferReport[] = [];
          for (const operation of operations) {
            if (
              operation.kind !== "send" ||
              (operation.status !== "issued" &&
                operation.status !== "pending" &&
                operation.status !== "externalized")
            )
              continue;
            const handedOut = handedOutOf(proofsBefore, operation);
            if (
              handedOut.length === 0 ||
              !handedOut.every((proof) => spentIds.has(proof.id))
            )
              continue;
            yield* patchOperation(
              ctx,
              operation,
              { status: "done" },
              "claimed",
            );
            claimed.push(
              new ClaimedTransferReport({
                operationId: operation.id,
                amount: amountOf(handedOut),
              }),
            );
          }
          return claimed;
        });

      /** Detect handed-out tokens the recipient has claimed. */
      const checkIssued: Effect.Effect<IssuedClaimReport> = Effect.gen(
        function* () {
          const proofs = yield* proofStore.loadAll;
          const operations = yield* operationStore.loadAll;
          const handedOut = proofs.filter(
            (proof) =>
              proof.state === "handedOut" || proof.state === "externalized",
          );
          const spent: StoredProof[] = [];
          for (const group of groupByMint(handedOut)) {
            const states = yield* askMint(group);
            if (states === null) continue;
            spent.push(...(yield* applyAnswer(group, states, "claimed")));
          }
          return new IssuedClaimReport({
            claimed: yield* closeClaimed(operations, proofs, spent),
          });
        },
      ).pipe(inspectOperation(inspector, "validation.checkIssued", {}));

      /**
       * One transfer: the proofs it handed out (a `send`), or the proofs its
       * text carries (a `receive`, whose proofs are not the wallet's until
       * accepted). `spent` closes a handed-out send as claimed.
       */
      const checkTransfer = (
        operationId: OperationId,
      ): Effect.Effect<TransferCheckResult, OperationNotFound> =>
        Effect.gen(function* () {
          const operations = yield* operationStore.loadAll;
          const operation = operations.find(
            (candidate) => candidate.id === operationId,
          );
          if (operation === undefined || operation.tokenText === null) {
            return yield* new OperationNotFound({ operationId });
          }
          const unavailable = new TransferCheckResult({
            operationId,
            status: "unavailable",
          });
          const proofs = yield* proofStore.loadAll;
          const handedOut = handedOutOf(proofs, operation);
          if (operation.kind === "send") {
            if (handedOut.length === 0) {
              return new TransferCheckResult({
                operationId,
                status:
                  operation.status === "done" || operation.status === "returned"
                    ? "spent"
                    : "unavailable",
              });
            }
            const [group] = groupByMint(handedOut);
            if (group === undefined) return unavailable;
            const states = yield* askMint(group);
            if (states === null) return unavailable;
            const spent = yield* applyAnswer(group, states, "check");
            if (spent.length === handedOut.length) {
              yield* closeClaimed(operations, proofs, spent);
              return new TransferCheckResult({ operationId, status: "spent" });
            }
            return group.proofs.every(
              (_, index) => answerAt(states, index) !== "unknown",
            )
              ? new TransferCheckResult({ operationId, status: "live" })
              : unavailable;
          }
          const decoded = yield* Effect.map(
            Effect.option(instances.get(operation.mint, operation.unit)),
            (wallet) =>
              wallet._tag === "None"
                ? null
                : decodeWithKeysets(
                    operation.tokenText ?? "",
                    wallet.value.keyChain
                      .getKeysets()
                      .map((keyset) => keyset.id),
                  ),
          );
          if (decoded === null) return unavailable;
          const wallet = yield* Effect.option(
            instances.get(operation.mint, operation.unit),
          );
          if (wallet._tag === "None") return unavailable;
          const states = yield* Effect.option(
            checkProofStates(wallet.value, operation.mint, decoded.proofs),
          );
          if (states._tag === "None") return unavailable;
          const answers = decoded.proofs.map((_, index) =>
            answerAt(states.value, index),
          );
          if (answers.some((answer) => answer === "unknown"))
            return unavailable;
          return new TransferCheckResult({
            operationId,
            status: answers.every((answer) => answer === "spent")
              ? "spent"
              : "live",
          });
        }).pipe(
          inspectOperation(inspector, "validation.checkTransfer", {
            operationId,
          }),
        );

      /** Read-only NUT-07 snapshot of every proof that is not yet spent. */
      const inspectProofStates: Effect.Effect<
        ReadonlyArray<ProofStateSnapshot>
      > = Effect.gen(function* () {
        const proofs = (yield* proofStore.loadAll).filter(
          (proof) => proof.state !== "spent",
        );
        const snapshots = new Map<string, ProofStateSnapshot>(
          proofs.map((proof) => [
            proof.id,
            new ProofStateSnapshot({ proofId: proof.id, state: "unknown" }),
          ]),
        );
        yield* Effect.forEach(
          groupByMint(proofs),
          (group) =>
            Effect.gen(function* () {
              const states = yield* askMint(group);
              if (states === null) return;
              group.proofs.forEach((proof, index) => {
                snapshots.set(
                  proof.id,
                  new ProofStateSnapshot({
                    proofId: proof.id,
                    state: answerAt(states, index),
                  }),
                );
              });
            }),
          { concurrency: 4, discard: true },
        );
        return [...snapshots.values()];
      }).pipe(inspectOperation(inspector, "validation.inspectProofStates", {}));

      return {
        checkAll,
        checkTransfer,
        checkIssued,
        inspectProofStates,
      } as const;
    }),
  },
) {}
