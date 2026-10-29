import type { LightningFeeProbeResult } from "@linky-fit/linkshu";
import { Result } from "effect";
import React from "react";
import {
  isTestMintUrl,
  normalizeMintUrl,
  PRODUCTION_MINTS,
} from "../../../utils/mint";
import type { ProbeLightningFee } from "../composition/useLinkshuComposition";

// A failed probe is not retried on every navigation; successes persist for a
// day inside linkshu FeeProbe's own cache, which the probe call reads first.
const FAILED_PROBE_RETRY_MS = 10 * 60 * 1000;
const failedProbeAtByMint = new Map<string, number>();

export type LightningFeeState = LightningFeeProbeResult | "failed" | "pending";

// The probe invoice must come from a real Lightning-backed mint (a dev
// FakeWallet invoice cannot be quoted), so this ignores the env presets.
const pickProbeMint = (mintUrl: string): string | null =>
  PRODUCTION_MINTS.map(normalizeMintUrl).find(
    (candidate) => candidate !== mintUrl,
  ) ?? null;

/** The mint's Lightning fee from one probe per mint; `pending` without a mint to ask. */
export const useLightningFeeProbe = (
  probeLightningFee: ProbeLightningFee | null,
  mintUrl: string | null,
): LightningFeeState => {
  const [byMint, setByMint] = React.useState<Record<string, LightningFeeState>>(
    {},
  );

  React.useEffect(() => {
    if (probeLightningFee === null || mintUrl === null) return;
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
        if (Result.isSuccess(outcome)) {
          setByMint((prev) => ({ ...prev, [mintUrl]: outcome.success }));
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

  return (mintUrl === null ? undefined : byMint[mintUrl]) ?? "pending";
};
