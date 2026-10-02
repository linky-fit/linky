import { parseMintUrl } from "@linky-fit/linkshu";
import { sqliteTrue } from "@linky-fit/linksync";
import { Gauge, Wallet } from "lucide-react";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useMintSettingsContext } from "../app/context/SystemSettingsContexts";
import { holdingOf, mintHoldings } from "../app/lib/mintHoldings";
import { MintBadge } from "../components/MintBadge";
import { MintDeferredReceives } from "../components/MintDeferredReceives";
import { MintFees } from "../components/MintFees";
import { MintIcon } from "../components/MintIcon";
import { MintMoveFundsForm } from "../components/MintMoveFundsForm";
import { navigateTo } from "../hooks/useRouting";
import { LOCAL_MINT_INFO_STORAGE_KEY_PREFIX } from "../utils/constants";
import { normalizeLocale } from "../utils/formatting";
import {
  formatMintLabel,
  isHiddenTestMint,
  MAIN_MINT_URL,
  mintKindBadge,
  normalizeMintUrl,
  PRESET_MINTS,
} from "../utils/mint";
import { safeLocalStorageSetJson } from "../utils/storage";

/** Other mints funds can move to: the default first, then funded mints and presets. */
const moveTargets = (
  sourceMint: string,
  defaultMint: string,
  fundedMints: readonly string[],
  allowTestMints: boolean,
): string[] =>
  [defaultMint, ...fundedMints, ...PRESET_MINTS]
    .map(normalizeMintUrl)
    .filter(
      (mint, index, all) =>
        all.indexOf(mint) === index &&
        mint !== sourceMint &&
        !isHiddenTestMint(mint, allowTestMints),
    );

interface InfoRowProps {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}

function InfoRow({ icon, label, value }: InfoRowProps) {
  return (
    <div className="settings-row">
      <div className="settings-left">
        <span className="settings-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="settings-label">{label}</span>
      </div>
      <div className="settings-right">
        <span className="settings-value" aria-label={label}>
          {value}
        </span>
      </div>
    </div>
  );
}

export function MintDetailPage() {
  const {
    allowTestMints,
    appOwnerIdRef,
    applyDefaultMintSelection,
    cashuIsBusy,
    cashuProofs,
    defaultMintUrl,
    estimateMintMove,
    getMintIconUrl,
    getMintRuntime,
    mintInfoByUrl,
    moveMintFunds,
    pendingMintDeleteUrl,
    refreshMintInfo,
    setMintInfoAll,
    setPendingMintDeleteUrl,
    setStatus,
  } = useMintSettingsContext();
  const { formatDisplayedAmountText, lang, route, t } = useAppShellCore();
  const [isSettingDefault, setIsSettingDefault] = React.useState(false);
  const mintUrl = route.kind === "mint" ? route.mintUrl : "";

  const cleaned = normalizeMintUrl(mintUrl);
  const row = mintInfoByUrl.get(cleaned) ?? null;
  const holdings = mintHoldings(cashuProofs);
  const holding = holdingOf(holdings, cleaned);
  const defaultMint = normalizeMintUrl(defaultMintUrl ?? MAIN_MINT_URL);
  const isDefault = cleaned === defaultMint;

  if (
    parseMintUrl(cleaned) === null ||
    isHiddenTestMint(cleaned, allowTestMints)
  ) {
    return (
      <section className="panel">
        <p className="muted">{t("mintNotFound")}</p>
      </section>
    );
  }

  const fundedMints = [...holdings]
    .filter(([, mintHolding]) => mintHolding.balance > 0)
    .map(([mint]) => mint);

  const runtime = getMintRuntime(cleaned);
  const lastCheckedAtSec = runtime?.lastCheckedAtSec ?? 0;
  const latencyMs = runtime?.latencyMs ?? null;
  const kindBadge = mintKindBadge(cleaned);

  const deleteMint = () => {
    if (pendingMintDeleteUrl !== cleaned) {
      setStatus(t("deleteArmedHint"));
      setPendingMintDeleteUrl(cleaned);
      return;
    }
    const ownerId = appOwnerIdRef.current;
    if (ownerId) {
      setMintInfoAll((prev) => {
        const next = prev.map((mintInfoRow) =>
          normalizeMintUrl(mintInfoRow.url) === cleaned
            ? { ...mintInfoRow, isDeleted: sqliteTrue }
            : mintInfoRow,
        );
        safeLocalStorageSetJson(
          `${LOCAL_MINT_INFO_STORAGE_KEY_PREFIX}.${ownerId}`,
          next,
        );
        return next;
      });
    }
    setPendingMintDeleteUrl(null);
    navigateTo({ route: "mints" });
  };

  const setAsDefault = async () => {
    setIsSettingDefault(true);
    await applyDefaultMintSelection(cleaned);
    setIsSettingDefault(false);
  };

  return (
    <section className="panel settings-page">
      <div className="settings-section mint-detail-header">
        <div className="mint-detail-identity">
          <MintIcon getMintIconUrl={getMintIconUrl} mint={cleaned} />
          <h2 className="mint-detail-name">{formatMintLabel(cleaned)}</h2>
          {isDefault ? <MintBadge kind="default" /> : null}
          {kindBadge !== null ? <MintBadge kind={kindBadge} /> : null}
        </div>
        {isDefault ? null : (
          <div className="settings-row">
            <button
              type="button"
              className="btn-wide secondary"
              disabled={cashuIsBusy || isSettingDefault}
              onClick={() => void setAsDefault()}
            >
              {t("mintSetAsDefault")}
            </button>
          </div>
        )}
      </div>

      <div className="settings-section">
        <h2 className="settings-section-title">{t("mintFundsTitle")}</h2>
        <InfoRow
          icon={<Wallet size={18} />}
          label={t("mintBalance")}
          value={formatDisplayedAmountText(holding.balance)}
        />
      </div>

      <MintDeferredReceives mint={cleaned} />

      {holding.balance > 0 ? (
        <div className="settings-section">
          <h2 className="settings-section-title">{t("mintMoveTitle")}</h2>
          <MintMoveFundsForm
            key={cleaned}
            available={holding.balance}
            busy={cashuIsBusy}
            estimateMintMove={estimateMintMove}
            getMintIconUrl={getMintIconUrl}
            moveMintFunds={moveMintFunds}
            sourceMint={cleaned}
            targets={moveTargets(
              cleaned,
              defaultMint,
              fundedMints,
              allowTestMints,
            )}
          />
        </div>
      ) : null}

      <div className="settings-section">
        <h2 className="settings-section-title">{t("mintFees")}</h2>
        <MintFees mint={cleaned} />
      </div>

      {row !== null ? (
        <div className="settings-section">
          <h2 className="settings-section-title">{t("mintInfoTitle")}</h2>
          <InfoRow
            icon={<Gauge size={18} />}
            label={t("mintLatency")}
            value={
              latencyMs !== null ? (
                `${latencyMs} ms`
              ) : (
                <span className="muted">{t("unknown")}</span>
              )
            }
          />
          <div className="settings-row">
            <button
              type="button"
              className="btn-wide secondary"
              onClick={() => void refreshMintInfo(cleaned)}
            >
              {t("mintRefresh")}
            </button>
          </div>
          <div className="settings-row">
            <button
              type="button"
              className={
                pendingMintDeleteUrl === cleaned
                  ? "btn-wide danger"
                  : "btn-wide"
              }
              onClick={deleteMint}
            >
              {t("mintDelete")}
            </button>
          </div>
          {lastCheckedAtSec ? (
            <p className="muted settings-error-note">
              {t("mintLastChecked")}:{" "}
              {new Date(lastCheckedAtSec * 1000).toLocaleString(
                normalizeLocale(lang),
              )}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
