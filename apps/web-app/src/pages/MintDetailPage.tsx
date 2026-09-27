import { parseMintUrl } from "@linky/linkshu";
import { sqliteTrue } from "@linky/linksync";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useMintSettingsContext } from "../app/context/SystemSettingsContexts";
import { holdingOf, mintHoldings } from "../app/lib/mintHoldings";
import { MintMoveFundsForm } from "../components/MintMoveFundsForm";
import { navigateTo } from "../hooks/useRouting";
import { LOCAL_MINT_INFO_STORAGE_KEY_PREFIX } from "../utils/constants";
import { normalizeLocale } from "../utils/formatting";
import {
  extractPpk,
  isHiddenTestMint,
  MAIN_MINT_URL,
  normalizeMintUrl,
  PRESET_MINTS,
} from "../utils/mint";
import { safeLocalStorageSetJson } from "../utils/storage";

const isPpkSearchInput = (
  value: unknown,
): value is Parameters<typeof extractPpk>[0] => {
  if (value === null) return true;
  if (Array.isArray(value)) return true;
  const valueType = typeof value;
  return (
    valueType === "string" ||
    valueType === "number" ||
    valueType === "boolean" ||
    valueType === "bigint" ||
    valueType === "symbol" ||
    valueType === "object"
  );
};

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

export function MintDetailPage() {
  const {
    allowTestMints,
    appOwnerIdRef,
    applyDefaultMintSelection,
    cashuIsBusy,
    cashuProofs,
    defaultMintUrl,
    estimateMintMove,
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
  const mintUrl = route.kind === "mint" ? route.mintUrl : "";

  const cleaned = normalizeMintUrl(mintUrl);
  const row = mintInfoByUrl.get(cleaned) ?? null;
  const holdings = mintHoldings(cashuProofs);
  const holding = holdingOf(holdings, cleaned);
  const defaultMint = normalizeMintUrl(defaultMintUrl ?? MAIN_MINT_URL);

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

  const renderCountRow = (label: string, value: string) => (
    <div className="settings-row">
      <div className="settings-left">
        <span className="settings-label">{label}</span>
      </div>
      <div className="settings-right">
        <span className="relay-url" aria-label={label}>
          {value}
        </span>
      </div>
    </div>
  );

  const holdingSection = (
    <div>
      {renderCountRow(
        t("mintBalance"),
        formatDisplayedAmountText(holding.balance),
      )}
      {renderCountRow(t("mintProofsAvailable"), String(holding.availableCount))}
      {renderCountRow(t("mintProofsHeld"), String(holding.heldCount))}
      {renderCountRow(t("mintProofsHandedOut"), String(holding.handedOutCount))}
      <div className="settings-row">
        {cleaned === defaultMint ? (
          <span className="muted">✓ {t("mintIsDefault")}</span>
        ) : (
          <button
            type="button"
            className="btn-wide secondary"
            disabled={cashuIsBusy}
            onClick={() => void applyDefaultMintSelection(cleaned)}
          >
            {t("mintSetAsDefault")}
          </button>
        )}
      </div>
      {holding.balance > 0 ? (
        <div className="settings-row">
          <div className="mint-move-form">
            <h2 className="settings-section-title">{t("mintMoveTitle")}</h2>
            <MintMoveFundsForm
              key={cleaned}
              available={holding.balance}
              busy={cashuIsBusy}
              estimateMintMove={estimateMintMove}
              moveMintFunds={moveMintFunds}
              sourceMint={cleaned}
              targets={moveTargets(
                cleaned,
                defaultMint,
                fundedMints,
                allowTestMints,
              )}
              t={t}
            />
          </div>
        </div>
      ) : null}
    </div>
  );

  if (row === null) {
    return <section className="panel">{holdingSection}</section>;
  }

  const feesJson = (row.feesJson ?? "").trim();

  const runtime = getMintRuntime(cleaned);
  const lastCheckedAtSec = runtime?.lastCheckedAtSec ?? 0;
  const latencyMs = runtime?.latencyMs ?? null;

  const ppk = (() => {
    if (!feesJson) return null;
    try {
      const parsed: unknown = JSON.parse(feesJson);
      if (!isPpkSearchInput(parsed)) return null;
      const found = extractPpk(parsed);
      if (typeof found === "number" && Number.isFinite(found)) {
        return found;
      }
      return null;
    } catch {
      return null;
    }
  })();

  return (
    <section className="panel">
      {holdingSection}
      <div>
        <div className="settings-row">
          <div className="settings-left">
            <span className="settings-icon" aria-hidden="true">
              🔗
            </span>
            <span className="settings-label">{t("mintUrl")}</span>
          </div>
          <div className="settings-right">
            <span className="relay-url">{cleaned}</span>
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-left">
            <span className="settings-icon" aria-hidden="true">
              💸
            </span>
            <span className="settings-label">{t("mintFees")}</span>
          </div>
          <div className="settings-right">
            {ppk !== null ? (
              <span className="relay-url">ppk: {ppk}</span>
            ) : feesJson ? (
              <span className="relay-url">{feesJson}</span>
            ) : (
              <span className="muted">{t("unknown")}</span>
            )}
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-left">
            <span className="settings-icon" aria-hidden="true">
              ⏱
            </span>
            <span className="settings-label">Latency</span>
          </div>
          <div className="settings-right">
            {latencyMs !== null ? (
              <span className="relay-url">{latencyMs} ms</span>
            ) : (
              <span className="muted">{t("unknown")}</span>
            )}
          </div>
        </div>

        <div className="settings-row">
          <button
            type="button"
            className="btn-wide secondary"
            onClick={() => {
              void refreshMintInfo(cleaned);
            }}
          >
            {t("mintRefresh")}
          </button>
        </div>

        <div className="settings-row">
          <button
            type="button"
            className={
              pendingMintDeleteUrl === cleaned ? "btn-wide danger" : "btn-wide"
            }
            onClick={() => {
              if (pendingMintDeleteUrl === cleaned) {
                const ownerId = appOwnerIdRef.current;
                if (ownerId) {
                  setMintInfoAll((prev) => {
                    const next = prev.map((mintInfoRow) => {
                      const url = normalizeMintUrl(mintInfoRow.url);
                      if (url !== cleaned) return mintInfoRow;
                      return {
                        ...mintInfoRow,
                        isDeleted: sqliteTrue,
                      };
                    });
                    safeLocalStorageSetJson(
                      `${LOCAL_MINT_INFO_STORAGE_KEY_PREFIX}.${ownerId}`,
                      next,
                    );
                    return next;
                  });
                }

                setPendingMintDeleteUrl(null);
                navigateTo({ route: "mints" });
                return;
              }
              setStatus(t("deleteArmedHint"));
              setPendingMintDeleteUrl(cleaned);
            }}
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
    </section>
  );
}
