import type { ProofStateSnapshot } from "@linky/linkshu";
import { useEffect, useState } from "react";
import type { InspectCashuProofStates } from "../app/hooks/composition/useLinkshuComposition";
import { nowSeconds } from "../utils/time";

interface Snapshot<Token> {
  inspect: InspectCashuProofStates;
  tokens: readonly Token[];
  revision: number;
  reports: readonly ProofStateSnapshot[];
  checkedAt: number;
}

/**
 * The mint's current answer for every unspent stored proof, refreshed when
 * `tokens` (by reference) or `inspect` change, or on `refresh()`. Stale
 * answers never apply to a newer input array.
 */
export const useTokenProofStates = <Token>(
  tokens: readonly Token[],
  inspect: InspectCashuProofStates | null,
) => {
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot<Token> | null>(null);
  const current =
    snapshot?.tokens === tokens &&
    snapshot.revision === revision &&
    snapshot.inspect === inspect;
  useEffect(() => {
    if (inspect === null) return;
    let cancelled = false;
    const finish = (reports: readonly ProofStateSnapshot[]) => {
      if (!cancelled)
        setSnapshot({
          tokens,
          revision,
          reports,
          inspect,
          checkedAt: nowSeconds(),
        });
    };
    void inspect()
      .then(finish)
      .catch(() => finish([]));
    return () => {
      cancelled = true;
    };
  }, [tokens, inspect, revision]);
  return {
    reports: current ? snapshot.reports : [],
    checkedAt: current ? snapshot.checkedAt : null,
    loading: inspect !== null && !current,
    refresh: () => setRevision((value) => value + 1),
  };
};
