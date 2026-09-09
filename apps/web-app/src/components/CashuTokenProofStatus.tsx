import { useMemo } from "react";
import type { InspectCashuTokenProofStates } from "../app/hooks/composition/useLinkshuComposition";
import { useAppShellCore } from "../app/context/AppShellContexts";
import type { CashuTokenRow } from "../evolu";
import { useTokenProofStates } from "../hooks/useTokenProofStates";
import { normalizeLocale } from "../utils/formatting";

interface CashuTokenProofStatusProps {
  row: CashuTokenRow;
  amount: number;
  inspect: InspectCashuTokenProofStates | null;
  busy: boolean;
}

export const CashuTokenProofStatus = ({
  row,
  amount,
  inspect,
  busy,
}: CashuTokenProofStatusProps) => {
  const { t, lang, formatDisplayedAmountText } = useAppShellCore();
  const tokens = useMemo(() => [row], [row]);
  const { reports, loading, refresh, checkedAt } = useTokenProofStates(
    tokens,
    inspect,
  );
  const report = reports.find((entry) => entry.rowId === String(row.id));
  const unknown = report?.unknown ?? amount;

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
            <dd>{formatDisplayedAmountText(report?.unspent ?? 0)}</dd>
            <dt>{t("cashuPendingAtMint")}</dt>
            <dd>{formatDisplayedAmountText(report?.pending ?? 0)}</dd>
            {(report?.spent ?? 0) > 0 ? (
              <>
                <dt>{t("cashuSpentProofs")}</dt>
                <dd>{formatDisplayedAmountText(report?.spent ?? 0)}</dd>
              </>
            ) : null}
            {unknown > 0 ? (
              <>
                <dt>{t("cashuUnknownProofs")}</dt>
                <dd>{formatDisplayedAmountText(unknown)}</dd>
              </>
            ) : null}
          </dl>
          {(report?.pending ?? 0) > 0 ? (
            <div className="cashu-token-pending-detail">
              <p>{t("cashuPendingOutcome")}</p>
              <dl>
                <dt>{t("cashuPendingRelease")}</dt>
                <dd>{t("cashuPendingReleaseUnknown")}</dd>
                <dt>{t("cashuPendingSince")}</dt>
                <dd>{t("cashuPendingNotRecorded")}</dd>
                <dt>{t("cashuPendingOperation")}</dt>
                <dd>{t("cashuPendingOperationUnknown")}</dd>
              </dl>
              <p className="muted">{t("cashuPendingQuoteExpiryHint")}</p>
            </div>
          ) : null}
          {unknown > 0 ? (
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
