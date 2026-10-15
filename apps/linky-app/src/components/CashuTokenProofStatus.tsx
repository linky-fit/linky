import type { ProofStateSnapshot, StoredProof } from "@linky-fit/linkshu";
import {
  Button,
  Card,
  LoadingState,
  Section,
  Text,
  ListRow,
} from "@linky-fit/ui";
import { useMemo } from "react";
import type { InspectCashuProofStates } from "../app/hooks/composition/useLinkshuComposition";
import { useDisplayAmounts, useTranslation } from "../app/hooks/shell";
import { useTokenProofStates } from "../hooks/useTokenProofStates";
import { formatTimeAgo } from "../utils/formatting";

interface CashuTokenProofStatusProps {
  /** The proofs a transfer handed out, as the inventory holds them. */
  proofs: readonly StoredProof[];
  inspect: InspectCashuProofStates | null;
  busy: boolean;
}

/** Amounts of `proofs` per mint answer; an unanswered proof is `unknown`. */
const sumProofsByMintState = (
  proofs: readonly StoredProof[],
  reports: readonly ProofStateSnapshot[],
) => {
  const byId = new Map(reports.map((report) => [report.proofId, report]));
  const sums = { unspent: 0, pending: 0, spent: 0, unknown: 0 };
  for (const proof of proofs) {
    const state =
      proof.state === "spent"
        ? "spent"
        : (byId.get(proof.id)?.state ?? "unknown");
    sums[state] += proof.amount;
  }
  return sums;
};

/** The mint's answer about a transfer's proofs; read-only, refreshable. */
export const CashuTokenProofStatus = ({
  proofs,
  inspect,
  busy,
}: CashuTokenProofStatusProps) => {
  const { t, lang } = useTranslation();
  const { formatDisplayedAmountText } = useDisplayAmounts();
  const tokens = useMemo(() => proofs, [proofs]);
  const { reports, loading, refresh, checkedAt } = useTokenProofStates(
    tokens,
    inspect,
  );
  const sums = sumProofsByMintState(proofs, reports);

  const amountRow = (label: string, amount: number) => (
    <ListRow title={label} value={formatDisplayedAmountText(amount)} />
  );

  return (
    <Card outlined aria-label={t("cashuProofStatus")}>
      <Section title={t("cashuProofStatus")}>
        {loading ? (
          <LoadingState label={t("cashuCheckingProofs")} />
        ) : (
          <>
            {amountRow(t("cashuUnspentProofs"), sums.unspent)}
            {amountRow(t("cashuPendingAtMint"), sums.pending)}
            {sums.spent > 0
              ? amountRow(t("cashuSpentProofs"), sums.spent)
              : null}
            {sums.unknown > 0
              ? amountRow(t("cashuUnknownProofs"), sums.unknown)
              : null}
            {sums.pending > 0 ? (
              <Text variant="caption" color="$colorMuted">
                {t("cashuPendingQuoteExpiryHint")}
              </Text>
            ) : null}
            {sums.unknown > 0 ? (
              <Text variant="caption" color="$colorMuted">
                {t("cashuUnknownProofsHint")}
              </Text>
            ) : null}
            {checkedAt !== null ? (
              <Text variant="caption" color="$colorMuted">
                {`${t("cashuProofLastChecked")}: ${formatTimeAgo(checkedAt, lang)}`}
              </Text>
            ) : null}
          </>
        )}
      </Section>
      <Button
        variant="secondary"
        size="sm"
        alignSelf="flex-start"
        onPress={refresh}
        disabled={loading || busy || inspect === null}
      >
        {t("cashuRefreshProofs")}
      </Button>
    </Card>
  );
};
