import { Effect, Exit } from "effect";
import { Amount, KeysetId, MintUrl } from "../domain/primitives";
import type { LoadedWallet } from "../mint/internal/WalletInstances";
import { fakeWallet } from "../testing/fakeWallet";
import { Proof } from "../token/domain";
import {
  checkProofStates,
  dedupeProofs,
  partitionGroupsByState,
  spentSecrets,
  unspentProofs,
} from "./proofStates";
import type { ProofStateEntry } from "./proofStates";

/**
 * Behavior pinned from the web app's `utils/cashuProofs.test.ts` and
 * `hooks/cashu/cashuProofState.test.ts`, adapted to the package's proofs and
 * effects. The rules are the same: one call for every group, offsets slice
 * the answer, PENDING is not spent, and a truncated answer never convicts a
 * row.
 */

const keysetHex = KeysetId.make("009a1f293253e41e");
const mint = MintUrl.make("https://mint.example");

const proof = (secret: string): Proof =>
  new Proof({
    id: keysetHex,
    amount: Amount.make(1),
    secret,
    C: "02" + "ab".repeat(32),
  });

const states = (...names: ReadonlyArray<string>): Array<ProofStateEntry> =>
  names.map((state) => ({ state }));

const group = (id: string, secrets: ReadonlyArray<string>) => ({
  id,
  proofs: secrets.map(proof),
});

const idsOf = (groups: ReadonlyArray<{ id: string }>): ReadonlyArray<string> =>
  groups.map((entry) => entry.id);

describe("partitionGroupsByState", () => {
  it("does not poison unrelated rows when one row is fully spent", () => {
    const groups = [
      group("A", ["a1", "a2"]),
      group("B", ["b1"]),
      group("C", ["c1"]),
    ];

    const partition = partitionGroupsByState(
      groups,
      states("UNSPENT", "UNSPENT", "UNSPENT", "SPENT"),
    );

    expect(idsOf(partition.fullySpent)).toEqual(["C"]);
    expect(partition.unknown).toEqual([]);
    expect(partition.live.map((entry) => entry.group.id)).toEqual(["A", "B"]);
    expect(partition.live.map((entry) => entry.unspent.length)).toEqual([2, 1]);
  });

  it("keeps a partially-spent row alive with only the unspent proofs", () => {
    const groups = [group("A", ["a1", "a2", "a3"])];

    const partition = partitionGroupsByState(
      groups,
      states("SPENT", "UNSPENT", "SPENT"),
    );

    expect(partition.fullySpent).toEqual([]);
    expect(partition.live).toHaveLength(1);
    expect(partition.live[0]?.unspent.map((entry) => entry.secret)).toEqual([
      "a2",
    ]);
  });

  it("treats PENDING as unknown — not spent — so the row is not nuked", () => {
    const partition = partitionGroupsByState(
      [group("A", ["a1", "a2"])],
      states("PENDING", "SPENT"),
    );

    expect(idsOf(partition.unknown)).toEqual(["A"]);
    expect(partition.fullySpent).toEqual([]);
    expect(partition.live).toEqual([]);
  });

  it("flags rows with a truncated mint response as unknown", () => {
    const groups = [group("A", ["a1", "a2"]), group("B", ["b1"])];

    const partition = partitionGroupsByState(
      groups,
      states("UNSPENT", "UNSPENT"),
    );

    expect(partition.live.map((entry) => entry.group.id)).toEqual(["A"]);
    expect(idsOf(partition.unknown)).toEqual(["B"]);
    expect(partition.fullySpent).toEqual([]);
  });

  it("marks a row spent only when ALL its proofs are SPENT", () => {
    const partition = partitionGroupsByState(
      [group("A", ["a1", "a2"])],
      states("SPENT", "SPENT"),
    );

    expect(idsOf(partition.fullySpent)).toEqual(["A"]);
    expect(partition.live).toEqual([]);
    expect(partition.unknown).toEqual([]);
  });
});

describe("unspentProofs / spentSecrets", () => {
  it("keeps alignment with the input order", () => {
    const proofs = ["p1", "p2", "p3"].map(proof);

    expect(
      unspentProofs(proofs, states("UNSPENT", "SPENT", "UNSPENT")).map(
        (entry) => entry.secret,
      ),
    ).toEqual(["p1", "p3"]);
  });

  it("reads a short answer as no answer, each in its own direction", () => {
    const proofs = ["p1", "p2", "p3"].map(proof);
    const short = states("UNSPENT");

    // Restore imports only what came back unspent…
    expect(unspentProofs(proofs, short).map((entry) => entry.secret)).toEqual([
      "p1",
    ]);
    // …while send excludes only what came back spent.
    expect([...spentSecrets(proofs, short)]).toEqual([]);
  });
});

type StateName = "UNSPENT" | "PENDING" | "SPENT";

const walletAnswering = (
  answer: (secrets: ReadonlyArray<string>) => Promise<Array<StateName>>,
): { wallet: LoadedWallet; calls: Array<ReadonlyArray<string>> } => {
  const calls: Array<ReadonlyArray<string>> = [];
  const wallet = fakeWallet({
    keysetId: keysetHex,
    checkProofsStates: (proofs) => {
      const secrets = proofs.map((entry) => entry.secret ?? "");
      calls.push(secrets);
      return answer(secrets).then((names) =>
        names.map((state, index) => ({
          Y: secrets[index] ?? "",
          state,
          witness: null,
        })),
      );
    },
  });
  return { wallet, calls };
};

describe("checkProofStates", () => {
  it("checks every group's proofs in one call, in group order", async () => {
    const { wallet, calls } = walletAnswering((secrets) =>
      Promise.resolve(secrets.map(() => "UNSPENT" as const)),
    );
    const groups = [group("A", ["a1", "a2"]), group("B", ["b1"])];

    const exit = await Effect.runPromiseExit(
      checkProofStates(
        wallet,
        mint,
        groups.flatMap((entry) => entry.proofs),
      ),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(calls).toEqual([["a1", "a2", "b1"]]);
  });

  it("never reaches the mint for an empty proof list", async () => {
    const { wallet, calls } = walletAnswering(() =>
      Promise.reject(new Error("must not be called")),
    );

    const exit = await Effect.runPromiseExit(
      checkProofStates(wallet, mint, []),
    );

    expect(exit).toEqual(Exit.succeed([]));
    expect(calls).toEqual([]);
  });

  it("fails typed rather than guessing when the check is unavailable", async () => {
    const { wallet } = walletAnswering(() =>
      Promise.reject(new TypeError("fetch failed")),
    );

    const failure = await Effect.runPromise(
      Effect.flip(checkProofStates(wallet, mint, [proof("a1")])),
    );

    expect(failure).toMatchObject({ _tag: "MintUnreachable", mint });
  });
});

describe("dedupeProofs", () => {
  it("keeps the first proof of each secret", () => {
    const deduped = dedupeProofs([
      proof("a1"),
      proof("a2"),
      proof("a1"),
      proof("a3"),
    ]);

    expect(deduped.map((entry) => entry.secret)).toEqual(["a1", "a2", "a3"]);
  });
});
