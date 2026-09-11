import type { ProofStateSnapshot, StoredProof } from "@linky/linkshu";
import { useMemo } from "react";
import type { InspectCashuProofStates } from "../app/hooks/composition/useLinkshuComposition";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useTokenProofStates } from "../hooks/useTokenProofStates";
import { normalizeLocale } from "../utils/formatting";

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
  const { t, lang, formatDisplayedAmountText } = useAppShellCore();
  const tokens = useMemo(() => proofs, [proofs]);
  const { reports, loading, refresh, checkedAt } = useTokenProofStates(
    tokens,
    inspect,
  );
  const sums = sumProofsByMintState(proofs, reports);

  return (
    <section
      className="cashu-token-proof-status"
      aria-label={t("cashuProofStatus")}
    >
      <div className="list-header">
        <span>{t("cashuProofStatus")}</span>
        <button
          type="button"
          className="btn-small secondary"
          onClick={refresh}
          disabled={loading || busy || inspect === null}
        >
          {t("cashuRefreshProofs")}
        </button>
      </div>
      {loading ? (
        <p className="muted" role="status">
          {t("cashuCheckingProofs")}
        </p>
      ) : (
        <>
          <dl className="cashu-token-proof-amounts">
            <dt>{t("cashuUnspentProofs")}</dt>
            <dd>{formatDisplayedAmountText(sums.unspent)}</dd>
            <dt>{t("cashuPendingAtMint")}</dt>
            <dd>{formatDisplayedAmountText(sums.pending)}</dd>
            {sums.spent > 0 ? (
              <>
                <dt>{t("cashuSpentProofs")}</dt>
                <dd>{formatDisplayedAmountText(sums.spent)}</dd>
              </>
            ) : null}
            {sums.unknown > 0 ? (
              <>
                <dt>{t("cashuUnknownProofs")}</dt>
                <dd>{formatDisplayedAmountText(sums.unknown)}</dd>
              </>
            ) : null}
          </dl>
          {sums.pending > 0 ? (
            <p className="muted">{t("cashuPendingQuoteExpiryHint")}</p>
          ) : null}
          {sums.unknown > 0 ? (
            <p className="muted">{t("cashuUnknownProofsHint")}</p>
          ) : null}
          {checkedAt !== null ? (
            <p className="muted cashu-token-proof-checked">
              {t("cashuProofLastChecked")}:{" "}
              <time dateTime={new Date(checkedAt * 1000).toISOString()}>
                {new Date(checkedAt * 1000).toLocaleString(
                  normalizeLocale(lang),
                )}
              </time>
            </p>
          ) : null}
        </>
      )}
    </section>
  );
};
