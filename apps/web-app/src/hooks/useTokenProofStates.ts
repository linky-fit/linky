import type { TokenProofStateAmounts } from "@linky/linkshu";
import { useEffect, useState } from "react";
import type { InspectCashuTokenProofStates } from "../app/hooks/composition/useLinkshuComposition";
import { nowSeconds } from "../utils/time";

interface Snapshot<Token> {
  inspect: InspectCashuTokenProofStates;
  tokens: readonly Token[];
  revision: number;
  reports: readonly TokenProofStateAmounts[];
  checkedAt: number;
}

export const useTokenProofStates = <Token>(
  tokens: readonly Token[],
  inspect: InspectCashuTokenProofStates | null,
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
    const finish = (reports: readonly TokenProofStateAmounts[]) => {
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
