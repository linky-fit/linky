import { useAppShellCore } from "../app/context/AppShellContexts";
import { useMintSettingsContext } from "../app/context/SystemSettingsContexts";
import { holdingOf, mintHoldings } from "../app/lib/mintHoldings";
import { MintButton } from "../components/MintButton";
import { MintFees } from "../components/MintFees";
import { navigateTo } from "../hooks/useRouting";
import {
  formatMintLabel,
  isHiddenTestMint,
  isTestMintUrl,
  MAIN_MINT_URL,
  mintKindBadge,
  normalizeMintUrl,
  PRESET_MINTS,
} from "../utils/mint";

const ensureHttpsScheme = (value: string): string =>
  /^https?:\/\//i.test(value) ? value : `https://${value}`;

export function MintsPage() {
  const {
    allowTestMints,
    applyDefaultMintSelection,
    cashuIsBusy,
    cashuProofs,
    defaultMintUrl,
    defaultMintUrlDraft,
    getMintIconUrl,
    setDefaultMintUrlDraft,
    setStatus,
  } = useMintSettingsContext();
  const { formatDisplayedAmountText, t } = useAppShellCore();
  const selectedMint =
    normalizeMintUrl(defaultMintUrl ?? MAIN_MINT_URL) || MAIN_MINT_URL;
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

  const holdings = mintHoldings(cashuProofs);
  const buttonMints = (() => {
    const set = new Set<string>(PRESET_MINTS.map(normalizeMintUrl));
    if (selectedMint) set.add(selectedMint);
    for (const [mint, holding] of holdings) {
      if (holding.balance > 0) set.add(mint);
    }
    return Array.from(set.values()).filter(
      (mint) => !isHiddenTestMint(mint, allowTestMints),
    );
  })();
  const standardMints = buttonMints.filter((mint) => !isTestMintUrl(mint));
  const testMints = buttonMints.filter((mint) => isTestMintUrl(mint));

  const renderHolding = (mint: string) => {
    const holding = holdingOf(holdings, mint);
    if (holding.balance <= 0) return null;
    return (
      <div className="mint-choice-holding muted">
        {formatDisplayedAmountText(holding.balance)} ·{" "}
        {t("mintProofCount").replace("{count}", String(holding.availableCount))}
      </div>
    );
  };

  const saveCustomMint = async () => {
    if (isHiddenTestMint(cleanedDraft, allowTestMints)) {
      setStatus(t("mintTestMintNotAllowed"));
      return;
    }
    await applyDefaultMintSelection(cleanedDraft);
  };

  const renderMintButton = (mint: string) => {
    const normalized = normalizeMintUrl(mint);
    const isSelected = normalized === selectedMint;
    const isTestMint = isTestMintUrl(mint);

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
          label={formatMintLabel(mint)}
          badge={mintKindBadge(mint)}
          onClick={() => navigateTo({ route: "mint", mintUrl: normalized })}
        />
        {renderHolding(normalized)}
        {isSelected ? <MintFees mint={normalized} /> : null}
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
            <div
              className={`mint-choice-test-group${standardMints.length > 0 ? " has-separator" : ""}`}
            >
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
            onClick={() => void saveCustomMint()}
          >
            {t("saveChanges")}
          </button>
        ) : null}
      </div>
    </section>
  );
}
