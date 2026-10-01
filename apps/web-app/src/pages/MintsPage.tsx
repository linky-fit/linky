import { CirclePlus, Clock } from "lucide-react";
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

export function MintsPage() {
  const {
    allowTestMints,
    cashuDeferredReceives,
    cashuProofs,
    defaultMintUrl,
    getMintIconUrl,
  } = useMintSettingsContext();
  const { formatDisplayedAmountText, t } = useAppShellCore();
  const selectedMint =
    normalizeMintUrl(defaultMintUrl ?? MAIN_MINT_URL) || MAIN_MINT_URL;

  const holdings = mintHoldings(cashuProofs, cashuDeferredReceives);
  const buttonMints = (() => {
    const set = new Set<string>(PRESET_MINTS.map(normalizeMintUrl));
    if (selectedMint) set.add(selectedMint);
    for (const [mint, holding] of holdings) {
      if (holding.balance > 0 || holding.pending > 0) set.add(mint);
    }
    return Array.from(set.values()).filter(
      (mint) => !isHiddenTestMint(mint, allowTestMints),
    );
  })();
  const standardMints = buttonMints.filter((mint) => !isTestMintUrl(mint));
  const testMints = buttonMints.filter((mint) => isTestMintUrl(mint));
  const listedBalance = buttonMints.reduce(
    (sum, mint) => sum + holdingOf(holdings, mint).balance,
    0,
  );

  const renderHolding = (mint: string) => {
    const { balance, pending } = holdingOf(holdings, mint);
    if (balance <= 0 && pending <= 0) return null;
    return (
      <div className="mint-choice-holding">
        <div className="mint-choice-amounts">
          {balance > 0 ? (
            <span className="muted">{formatDisplayedAmountText(balance)}</span>
          ) : null}
          {pending > 0 ? (
            <span className="mint-choice-pending">
              <Clock aria-hidden="true" />
              {t("mintPendingAmount").replace(
                "{amount}",
                formatDisplayedAmountText(pending),
              )}
            </span>
          ) : null}
        </div>
        {balance > 0 ? (
          <div className="mint-choice-share" aria-hidden="true">
            <span
              className="mint-choice-share-fill"
              style={{ width: `${(balance / listedBalance) * 100}%` }}
            />
          </div>
        ) : null}
      </div>
    );
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
    <>
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
      </section>
      <button
        type="button"
        className="contacts-fab"
        onClick={() => navigateTo({ route: "mintNew" })}
        aria-label={t("mintAdd")}
        title={t("mintAdd")}
      >
        <CirclePlus className="contacts-fab-svgIcon" />
      </button>
    </>
  );
}
