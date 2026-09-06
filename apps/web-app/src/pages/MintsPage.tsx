import type { LightningFeeProbeResult } from "@linky/linkshu";
import { Either } from "effect";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useMintSettingsContext } from "../app/context/SystemSettingsContexts";
import type { ProbeLightningFee } from "../app/hooks/composition/useLinkshuComposition";
import { getMintFeePpk } from "../app/hooks/mint/mintInfoHelpers";
import { MintButton } from "../components/MintButton";
import {
  isTestMintUrl,
  MAIN_MINT_URL,
  normalizeMintUrl,
  PRESET_MINTS,
  PRODUCTION_MINTS,
} from "../utils/mint";
import { nowSeconds } from "../utils/time";

const RECOMMENDED_MINT_URL = "https://cashu.cz";

// Rough proof count of a typical Cashu payment, used to express ppk in sats.
const TYPICAL_PAYMENT_PROOF_COUNT = 6;

const ensureHttpsScheme = (value: string): string =>
  /^https?:\/\//i.test(value) ? value : `https://${value}`;

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

const FEE_INFO_RETRY_SEC = 60;

type LightningFeeState = LightningFeeProbeResult | "failed" | "pending";

// A failed probe is not retried on every navigation; successes persist for a
// day inside linkshu FeeProbe's own cache, which the probe call reads first.
const FAILED_PROBE_RETRY_MS = 10 * 60 * 1000;
const failedProbeAtByMint = new Map<string, number>();

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

export function MintsPage() {
  const {
    applyDefaultMintSelection,
    cashuIsBusy,
    defaultMintUrl,
    defaultMintUrlDraft,
    getMintIconUrl,
    mintInfoByUrl,
    probeLightningFee,
    refreshMintInfo,
    setDefaultMintUrlDraft,
  } = useMintSettingsContext();
  const { t } = useAppShellCore();
  const selectedMint =
    normalizeMintUrl(defaultMintUrl ?? MAIN_MINT_URL) || MAIN_MINT_URL;
  const stripped = (value: string) => value.replace(/^https?:\/\//i, "");
  const draftValue = defaultMintUrlDraft.trim();
  const cleanedDraft = draftValue
    ? normalizeMintUrl(ensureHttpsScheme(draftValue))
    : "";
  const isDraftValid = (() => {
    if (!cleanedDraft) return false;
    try {
      return new URL(cleanedDraft).hostname.includes(".");
    } catch {
      return false;
    }
  })();
  const canSave = isDraftValid && cleanedDraft !== selectedMint;

  const selectedMintRow = mintInfoByUrl.get(selectedMint);
  const selectedMintPpk = getMintFeePpk(selectedMintRow?.feesJson);
  const selectedMintCheckedAtSec = selectedMintRow?.lastCheckedAtSec ?? 0;
  React.useEffect(() => {
    if (selectedMintPpk !== null) return;
    const nowSec = nowSeconds();
    if (nowSec - selectedMintCheckedAtSec < FEE_INFO_RETRY_SEC) return;
    void refreshMintInfo(selectedMint);
  }, [
    refreshMintInfo,
    selectedMint,
    selectedMintCheckedAtSec,
    selectedMintPpk,
  ]);

  const lightningFee = useLightningFeeProbe(probeLightningFee, selectedMint);

  const buttonMints = (() => {
    const set = new Set<string>(PRESET_MINTS);
    if (selectedMint) set.add(selectedMint);
    return Array.from(set.values());
  })();
  const standardMints = buttonMints.filter((mint) => !isTestMintUrl(mint));
  const testMints = buttonMints.filter((mint) => isTestMintUrl(mint));

  const renderFees = () => (
    <div className="mint-fees">
      <span className="muted">{t("mintFeeCashuPayments")}</span>
      <span className="mint-fees-value">
        {selectedMintPpk !== null
          ? formatCashuFee(selectedMintPpk)
          : t("unknown")}
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

  const renderMintButton = (mint: string) => {
    const normalized = normalizeMintUrl(mint);
    const isSelected = normalized === selectedMint;
    const label = stripped(mint);
    const fallbackLetter = (label.match(/[a-z]/i)?.[0] ?? "?").toUpperCase();
    const isTestMint = isTestMintUrl(mint);
    const isRecommended = normalized === RECOMMENDED_MINT_URL;

    return (
      <div
        key={mint}
        className={`mint-choice-item${isSelected ? " is-selected" : ""}`}
      >
        <MintButton
          mint={mint}
          getMintIconUrl={getMintIconUrl}
          isSelected={isSelected}
          isTestMint={isTestMint}
          label={label}
          badgeLabel={
            isTestMint
              ? t("testMintBadge")
              : isRecommended
                ? t("recommendedMintBadge")
                : ""
          }
          badgeTone={isRecommended ? "recommended" : "test"}
          fallbackLetter={fallbackLetter}
          disabled={cashuIsBusy}
          onClick={() => void applyDefaultMintSelection(mint)}
        />
        {isSelected ? renderFees() : null}
      </div>
    );
  };

  return (
    <section className="panel">
      <div className="settings-row mints-content">
        <div className="mint-choice-list">
          <div className="mint-choice-group">
            {standardMints.map((mint) => renderMintButton(mint))}
          </div>
          {testMints.length > 0 ? (
            <div className="mint-choice-test-group">
              <div className="mint-choice-group">
                {testMints.map((mint) => renderMintButton(mint))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <label htmlFor="defaultMintUrl">{t("setCustomMint")}</label>
      <input
        id="defaultMintUrl"
        value={defaultMintUrlDraft}
        onChange={(e) => setDefaultMintUrlDraft(e.target.value)}
        placeholder="https://…"
        disabled={cashuIsBusy}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />

      <div className="panel-header panel-header-layout">
        {canSave ? (
          <button
            type="button"
            disabled={cashuIsBusy}
            onClick={async () => {
              await applyDefaultMintSelection(cleanedDraft);
            }}
          >
            {t("saveChanges")}
          </button>
        ) : null}
      </div>
    </section>
  );
}
