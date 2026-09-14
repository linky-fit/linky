import { Effect, Either } from "effect";
import { MintRejected } from "../../domain/errors";
import { NonNegativeAmount } from "../../domain/primitives";
import type { ProofId } from "../../domain/primitives";
import { inspectOperation, patchOperation } from "../../internal/operations";
import { setProofState, toDomainProof } from "../../internal/proofs";
import {
  checkProofStates,
  spentSecrets,
  unspentProofs,
} from "../../internal/proofStates";
import type { StoredProof } from "../../ports/ProofStore";
import { acceptAtMint } from "../../receive/internal/acceptFlow";
import type { ReceiveContext } from "../../receive/internal/acceptFlow";
import { ReclaimReport } from "../domain";
import { encodeProofs } from "./cashuProofs";

export const reclaimProofs = (
  ctx: ReceiveContext,
  ids: ReadonlyArray<ProofId>,
) =>
  Effect.gen(function* () {
    const selected = new Set(ids);
    const candidates = (yield* ctx.proofStore.loadAll).filter(
      (proof) => selected.has(proof.id) && proof.state !== "spent",
    );
    const groups = new Map<string, StoredProof[]>();
    for (const proof of candidates) {
      if (proof.state === "held") continue;
      const key = `${proof.mint}|${proof.unit}`;
      const group = groups.get(key) ?? [];
      group.push(proof);
      groups.set(key, group);
    }
    const reclaimed = new Set<ProofId>();
    const spent = new Set<ProofId>();
    let amount = 0;
    for (const group of groups.values()) {
      const first = group[0];
      if (first === undefined) continue;
      const outcome = yield* Effect.either(
        Effect.gen(function* () {
          const wallet = yield* ctx.instances.get(first.mint, first.unit);
          const proofs = group.map(toDomainProof);
          const states = yield* checkProofStates(wallet, first.mint, proofs);
          const spentAtMint = spentSecrets(proofs, states);
          const alreadySpent = group.filter((proof) =>
            spentAtMint.has(proof.secret),
          );
          yield* setProofState(ctx, alreadySpent, "spent", "reclaim");
          for (const proof of alreadySpent) spent.add(proof.id);
          const unspent = unspentProofs(proofs, states);
          if (unspent.length === 0) return 0;
          const encoded = encodeProofs({
            mint: first.mint,
            unit: first.unit,
            memo: null,
            proofs: unspent,
          });
          if (encoded === null)
            return yield* new MintRejected({
              mint: first.mint,
              code: null,
              detail: "stored proofs could not be encoded for reclaim",
            });
          const accepted = yield* acceptAtMint(
            ctx,
            wallet,
            {
              ...encoded,
              mint: first.mint,
              unit: first.unit,
              memo: null,
            },
            "reclaim",
          );
          const secrets = new Set(unspent.map((proof) => proof.secret));
          const returned = group.filter((proof) => secrets.has(proof.secret));
          yield* setProofState(ctx, returned, "spent", "reclaim");
          for (const proof of returned) reclaimed.add(proof.id);
          return accepted.amount;
        }).pipe(
          inspectOperation(ctx.inspector, "tokens.reclaimMint", {
            mint: first.mint,
            proofIds: group.map((proof) => proof.id),
            operations: group.map((proof) => ({
              operationId: proof.operationId,
            })),
          }),
        ),
      );
      if (Either.isRight(outcome)) amount += outcome.right;
    }
    const proofs = yield* ctx.proofStore.loadAll;
    for (const operation of yield* ctx.operationStore.loadAll) {
      if (operation.kind !== "send") continue;
      const linked = proofs.filter(
        (proof) => proof.operationId === operation.id,
      );
      if (
        !linked.some((proof) => reclaimed.has(proof.id) || spent.has(proof.id))
      )
        continue;
      if (!linked.every((proof) => proof.state === "spent")) continue;
      yield* patchOperation(
        ctx,
        operation,
        {
          status: linked.some((proof) => reclaimed.has(proof.id))
            ? "returned"
            : "done",
          error: null,
        },
        "reclaim",
      );
    }
    return new ReclaimReport({
      reclaimedAmount: NonNegativeAmount.make(amount),
      reclaimedProofs: [...reclaimed],
      spentProofs: [...spent],
      unresolvedProofs: candidates
        .filter((proof) => !reclaimed.has(proof.id) && !spent.has(proof.id))
        .map((proof) => proof.id),
    });
  }).pipe(inspectOperation(ctx.inspector, "tokens.reclaim", { proofIds: ids }));
