import type { LightningFeeProbeResult } from "@linky/linkshu";
import { Either } from "effect";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useMintSettingsContext } from "../app/context/SystemSettingsContexts";
import type { ProbeLightningFee } from "../app/hooks/composition/useLinkshuComposition";
import { getMintFeePpk } from "../app/hooks/mint/mintInfoHelpers";
import {
  isTestMintUrl,
  normalizeMintUrl,
  PRODUCTION_MINTS,
} from "../utils/mint";
import { nowSeconds } from "../utils/time";

// Rough proof count of a typical Cashu payment, used to express ppk in sats.
const TYPICAL_PAYMENT_PROOF_COUNT = 6;

const FEE_INFO_RETRY_SEC = 60;

// A failed probe is not retried on every navigation; successes persist for a
// day inside linkshu FeeProbe's own cache, which the probe call reads first.
const FAILED_PROBE_RETRY_MS = 10 * 60 * 1000;
const failedProbeAtByMint = new Map<string, number>();

type LightningFeeState = LightningFeeProbeResult | "failed" | "pending";

const formatCashuFee = (ppk: number): string => {
  const sats = Math.ceil((ppk * TYPICAL_PAYMENT_PROOF_COUNT) / 1000);
  return sats === 0 ? "0 sat" : `~${sats} sat`;
};

const formatPercent = (percent: number): string =>
  `~${percent.toFixed(1).replace(/\.0$/, "")} %`;

// The probe invoice must come from a real Lightning-backed mint (a dev
// FakeWallet invoice cannot be quoted), so this ignores the env presets.
const pickProbeMint = (mintUrl: string): string | null =>
  PRODUCTION_MINTS.map(normalizeMintUrl).find(
    (candidate) => candidate !== mintUrl,
  ) ?? null;

/** Fetches the mint's info once its keyset fee is unknown, at most once a minute. */
const useKeysetFeePpk = (mintUrl: string): number | null => {
  const { mintInfoByUrl, refreshMintInfo } = useMintSettingsContext();
  const row = mintInfoByUrl.get(mintUrl);
  const ppk = getMintFeePpk(row?.feesJson);
  const checkedAtSec = row?.lastCheckedAtSec ?? 0;

  React.useEffect(() => {
    if (ppk !== null) return;
    if (nowSeconds() - checkedAtSec < FEE_INFO_RETRY_SEC) return;
    void refreshMintInfo(mintUrl);
  }, [checkedAtSec, mintUrl, ppk, refreshMintInfo]);

  return ppk;
};

const useLightningFeeProbe = (
  probeLightningFee: ProbeLightningFee | null,
  mintUrl: string,
): LightningFeeState => {
  const [byMint, setByMint] = React.useState<Record<string, LightningFeeState>>(
    {},
  );

  React.useEffect(() => {
    if (probeLightningFee === null) return;
    if (byMint[mintUrl]) return;
    const failedAt = failedProbeAtByMint.get(mintUrl);
    if (
      failedAt !== undefined &&
      Date.now() - failedAt < FAILED_PROBE_RETRY_MS
    ) {
      setByMint((prev) => ({ ...prev, [mintUrl]: "failed" }));
      return;
    }
    const probeMint = isTestMintUrl(mintUrl) ? null : pickProbeMint(mintUrl);
    if (!probeMint) {
      setByMint((prev) => ({ ...prev, [mintUrl]: "failed" }));
      return;
    }
    setByMint((prev) => ({ ...prev, [mintUrl]: "pending" }));
    void probeLightningFee({ mint: mintUrl, probeMint })
      .then((outcome) => {
        if (Either.isRight(outcome)) {
          setByMint((prev) => ({ ...prev, [mintUrl]: outcome.right }));
          return;
        }
        failedProbeAtByMint.set(mintUrl, Date.now());
        setByMint((prev) => ({ ...prev, [mintUrl]: "failed" }));
      })
      .catch(() => {
        failedProbeAtByMint.set(mintUrl, Date.now());
        setByMint((prev) => ({ ...prev, [mintUrl]: "failed" }));
      });
  }, [byMint, mintUrl, probeLightningFee]);

  return byMint[mintUrl] ?? "pending";
};

interface MintFeesProps {
  mint: string;
}

export function MintFees({ mint }: MintFeesProps) {
  const { probeLightningFee } = useMintSettingsContext();
  const { t } = useAppShellCore();
  const mintUrl = normalizeMintUrl(mint);
  const ppk = useKeysetFeePpk(mintUrl);
  const lightningFee = useLightningFeeProbe(probeLightningFee, mintUrl);

  return (
    <div className="mint-fees">
      <span className="muted">{t("mintFeeCashuPayments")}</span>
      <span className="mint-fees-value">
        {ppk !== null ? formatCashuFee(ppk) : t("unknown")}
      </span>
      <span className="muted">{t("mintFeeLightningTopup")}</span>
      <span className="mint-fees-value">0 sat</span>
      <span className="muted">{t("mintFeeLightningPayments")}</span>
      <span className="mint-fees-value">
        {lightningFee === "pending"
          ? "…"
          : lightningFee === "failed"
            ? t("unknown")
            : formatPercent(lightningFee.percent)}
      </span>
    </div>
  );
}
