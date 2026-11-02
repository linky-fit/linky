import { Effect, Exit } from "effect";
import { MintUnreachable } from "../../domain/errors";
import { Amount, KeysetId, MintUrl } from "../../domain/primitives";
import type { ProofStateEntry } from "../../internal/proofStates";
import { Proof } from "../../token/domain";
import { scanKeyset } from "./scan";
import type { KeysetScanInput, RestoreBatch } from "./scan";

/**
 * Behavior pinned from the web app's
 * `hooks/cashu/cashuRestoreScanner.test.ts`: where the window starts, how the
 * cursor is derived, when the deep pass runs, and that a failed first request
 * leaves the keyset untouched.
 */

const mint = MintUrl.make("https://mint.example");

const proof = (secret: string): Proof =>
  new Proof({
    id: KeysetId.make("009a1f293253e41e"),
    amount: Amount.make(1),
    secret,
    C: "02" + "ab".repeat(32),
  });

const batch = (
  proofs: ReadonlyArray<Proof>,
  lastCounterWithSignature: number | null,
): RestoreBatch => ({ proofs, lastCounterWithSignature });

interface Harness {
  readonly input: KeysetScanInput;
  readonly restoreStarts: Array<number>;
  readonly checked: Array<ReadonlyArray<string>>;
}

const harness = (args: {
  restore: (start: number) => Effect.Effect<RestoreBatch, MintUnreachable>;
  proofStates?: (
    proofs: ReadonlyArray<Proof>,
  ) => Effect.Effect<ReadonlyArray<ProofStateEntry>, MintUnreachable>;
  knownSecrets?: ReadonlyArray<string>;
  cursor: number;
  counter: number;
}): Harness => {
  const restoreStarts: Array<number> = [];
  const checked: Array<ReadonlyArray<string>> = [];
  return {
    restoreStarts,
    checked,
    input: {
      restoreFrom: (start) => {
        restoreStarts.push(start);
        return args.restore(start);
      },
      proofStates: (proofs) => {
        checked.push(proofs.map((entry) => entry.secret));
        return (
          args.proofStates ??
          ((candidates: ReadonlyArray<Proof>) =>
            Effect.succeed(candidates.map(() => ({ state: "UNSPENT" }))))
        )(proofs);
      },
      knownSecrets: () => Effect.succeed(new Set(args.knownSecrets ?? [])),
      cursor: args.cursor,
      counter: args.counter,
    },
  };
};

describe("scanKeyset", () => {
  it("scans behind the high-water mark and returns fresh unspent proofs", async () => {
    const { input, restoreStarts, checked } = harness({
      cursor: 5000,
      counter: 4500,
      knownSecrets: ["known"],
      restore: () =>
        Effect.succeed(
          batch([proof("known"), proof("fresh"), proof("spent")], 4500),
        ),
      proofStates: (proofs) =>
        Effect.succeed(
          proofs.map((entry) => ({
            state: entry.secret === "spent" ? "SPENT" : "UNSPENT",
          })),
        ),
    });

    const scan = await Effect.runPromise(scanKeyset(input));

    // Window start = max(cursor, counter) - 4000.
    expect(restoreStarts).toEqual([1000]);
    // The already-stored proof is dropped before the states are requested, so
    // the answer stays aligned to what was asked.
    expect(checked).toEqual([["fresh", "spent"]]);
    expect(scan).toMatchObject({ status: "ok", nextCursor: 4501 });
    expect(scan.status === "ok" && scan.proofs.map((p) => p.secret)).toEqual([
      "fresh",
    ]);
  });

  it("deep scans from zero when the recent window has no spendable proofs", async () => {
    const { input, restoreStarts } = harness({
      cursor: 4200,
      counter: 4200,
      restore: (start) =>
        start === 0
          ? Effect.succeed(batch([proof("deep")], 4700))
          : Effect.succeed(batch([], null)),
    });

    const scan = await Effect.runPromise(scanKeyset(input));

    expect(restoreStarts).toEqual([200, 0]);
    expect(scan).toMatchObject({ status: "ok", nextCursor: 4701 });
    expect(scan.status === "ok" && scan.proofs.map((p) => p.secret)).toEqual([
      "deep",
    ]);
  });

  it("takes the furthest signature of both passes as the next cursor", async () => {
    const { input } = harness({
      cursor: 4200,
      counter: 4200,
      restore: (start) =>
        start === 0
          ? Effect.succeed(batch([proof("deep")], 300))
          : Effect.succeed(batch([], 4700)),
    });

    const scan = await Effect.runPromise(scanKeyset(input));

    expect(scan).toMatchObject({ status: "ok", nextCursor: 4701 });
  });

  it("leaves the keyset untouched when its first restore request fails", async () => {
    const { input, checked } = harness({
      cursor: 0,
      counter: 1,
      restore: () => new MintUnreachable({ mint, detail: null }),
    });

    const scan = await Effect.runPromise(scanKeyset(input));

    expect(scan).toEqual({ status: "unavailable" });
    expect(checked).toEqual([]);
  });

  it("keeps the windowed result when the deep pass fails", async () => {
    const { input, restoreStarts } = harness({
      cursor: 9000,
      counter: 0,
      restore: (start) =>
        start === 0
          ? new MintUnreachable({ mint, detail: null })
          : Effect.succeed(batch([], 4900)),
    });

    const scan = await Effect.runPromise(scanKeyset(input));

    expect(restoreStarts).toEqual([5000, 0]);
    expect(scan).toEqual({ status: "ok", nextCursor: 4901, proofs: [] });
  });

  it("imports nothing when the state check is unavailable", async () => {
    const { input } = harness({
      cursor: 0,
      counter: 0,
      restore: () => Effect.succeed(batch([proof("fresh")], 10)),
      proofStates: () => new MintUnreachable({ mint, detail: null }),
    });

    const exit = await Effect.runPromiseExit(scanKeyset(input));

    expect(exit).toEqual(
      Exit.succeed({ status: "ok", nextCursor: 11, proofs: [] }),
    );
  });

  it("reports no cursor when the tree holds no signature at all", async () => {
    const { input } = harness({
      cursor: 0,
      counter: 1,
      restore: () => Effect.succeed(batch([], null)),
    });

    const scan = await Effect.runPromise(scanKeyset(input));

    expect(scan).toEqual({ status: "ok", nextCursor: null, proofs: [] });
  });
});
