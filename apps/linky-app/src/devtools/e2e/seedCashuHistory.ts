import {
  cashuOperationIdFor,
  cashuProofIdFor,
  linkyScopes,
  type LinkyStore,
  type Mutation,
  type OwnerId,
} from "@linky-fit/linksync";
import { MintUrl, operationKeyOf, TokenText } from "@linky-fit/linkshu";
import { Effect } from "effect";
import { nowSeconds } from "../../utils/time";

export interface CashuHistory {
  readonly mint: string;
  readonly keysetId: string;
  /** Past sends to write; each leaves an operation and five spent proofs. */
  readonly sends: number;
}

const HANDED_OUT_PER_SEND = 3;
const INPUTS_PER_SEND = 2;
// The operation, one insert per proof, then one spent update per proof.
const MUTATIONS_PER_SEND = 1 + 2 * (HANDED_OUT_PER_SEND + INPUTS_PER_SEND);

const hex = (bytes: number): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

const spentProof = (
  { mint, keysetId }: CashuHistory,
  ownerId: OwnerId,
  state: "handedOut" | "available",
  operationId?: string,
): ReadonlyArray<Mutation> => {
  const secret = hex(32);
  const id = cashuProofIdFor(secret);
  return [
    {
      kind: "upsert",
      table: "cashuProof",
      ownerId,
      row: {
        id,
        mint,
        unit: "sat",
        keysetId,
        amount: 2 ** Math.floor(Math.random() * 10),
        secret,
        c: `02${hex(32)}`,
        dleq: JSON.stringify({ e: hex(32), s: hex(32), r: hex(32) }),
        state,
        ...(operationId === undefined ? {} : { operationId }),
      },
    },
    {
      kind: "update",
      table: "cashuProof",
      ownerId,
      row: { id, state: "spent" },
    },
  ];
};

/** One settled send as the wallet leaves it: its operation, the proofs it handed out and the inputs it spent. */
const pastSend = (
  history: CashuHistory,
  ownerId: OwnerId,
  createdAtSec: number,
): ReadonlyArray<Mutation> => {
  const tokenText = `cashuB${hex(300)}`;
  const id = cashuOperationIdFor(
    operationKeyOf({
      kind: "send",
      mint: MintUrl.make(history.mint),
      quoteId: null,
      tokenText: TokenText.make(tokenText),
    }),
  );
  return [
    {
      kind: "upsert",
      table: "cashuOperation",
      ownerId,
      row: {
        id,
        kind: "send",
        status: "done",
        mint: history.mint,
        unit: "sat",
        keysetId: history.keysetId,
        amount: 21,
        counter: 0,
        createdAtSec,
        tokenText,
      },
    },
    ...Array.from({ length: HANDED_OUT_PER_SEND }, () =>
      spentProof(history, ownerId, "handedOut", id),
    ).flat(),
    ...Array.from({ length: INPUTS_PER_SEND }, () =>
      spentProof(history, ownerId, "available"),
    ).flat(),
  ];
};

/**
 * Writes a long-lived wallet's history into the cashu scope: full shards of
 * past sends, rotated as the scope's rule would, without its cooldown.
 * Returns the active shard index.
 */
export const seedCashuHistory = async (
  store: LinkyStore,
  mutate: (mutations: ReadonlyArray<Mutation>) => Effect.Effect<void, Error>,
  history: CashuHistory,
): Promise<number> => {
  const rule = linkyScopes.cashu.rotation;
  if (rule === null) throw new Error("the cashu scope does not rotate");
  const sendsPerShard = Math.floor(rule.maxMutations / MUTATIONS_PER_SEND);
  const startSec = nowSeconds() - history.sends * 3600;
  for (let done = 0; done < history.sends; done += sendsPerShard) {
    if (done > 0) await Effect.runPromise(store.rotate("cashu"));
    const index = await Effect.runPromise(store.activeIndex("cashu"));
    const ownerId = store.shardOwner("cashu", index).id;
    const count = Math.min(sendsPerShard, history.sends - done);
    await Effect.runPromise(
      mutate(
        Array.from({ length: count }, (_, i) =>
          pastSend(history, ownerId, startSec + (done + i) * 3600),
        ).flat(),
      ),
    );
  }
  return Effect.runPromise(store.activeIndex("cashu"));
};
