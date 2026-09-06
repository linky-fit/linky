import { GENERIC_MINT_ICON_DATA_URL, isLightningAddress } from "@linky/linkshu";
import { SiteFooter } from "../SiteFooter";
import { SiteHeaderMenu } from "../SiteHeaderMenu";
import { useCashuPage } from "./useCashuPage";
function CashuPage() {
  const {
    locale,
    setLocale,
    tokenInput,
    setTokenInput,
    activeToken,
    tokenState,
    lightningAddress,
    setLightningAddress,
    redeemError,
    setRedeemError,
    redeemSuccess,
    isInspecting,
    isRedeeming,
    isAdditionalOptionsVisible,
    setIsAdditionalOptionsVisible,
    mintIconSrc,
    setMintIconSrc,
    tokenQr,
    activeCopy,
    tokenErrorMessage,
    displayedTokenAmountText,
    cycleDisplayCurrency,
    handleInspectSubmit,
    handleRedeemSubmit,
    handleCopyToken,
    handleOpenInWallet,
  } = useCashuPage();

  return (
    <main className="cashu-shell">
      <div className="site-backdrop" aria-hidden="true" />

      <header className="topbar">
        <a className="brand" href="/" aria-label="Linky home">
          <span className="brand-mark">
            <img className="brand-logo" src="/icon.svg" alt="Linky" />
          </span>
          <span className="brand-word">Linky</span>
        </a>

        <SiteHeaderMenu
          copy={activeCopy}
          locale={locale}
          onLocaleChange={setLocale}
        />
      </header>

      {redeemSuccess ? (
        <section className="cashu-token-view">
          <div className="cashu-panel cashu-panel-highlight cashu-success-panel">
            <div className="cashu-success-check" aria-hidden="true">
              ✓
            </div>
            <p className="cashu-success-title">{activeCopy.redeemConfirmed}</p>
            <p className="cashu-success-address">
              {activeCopy.redeemSuccessAddress.replace(
                "{address}",
                redeemSuccess.lightningAddress,
              )}
            </p>
          </div>
        </section>
      ) : !activeToken ? (
        <section className="cashu-entry">
          <div className="cashu-panel">
            <p className="cashu-page-kicker">Cashu</p>
            <h1>{activeCopy.pageTitle}</h1>
            <p className="lede">{activeCopy.subtitle}</p>

            <form className="cashu-form" onSubmit={handleInspectSubmit}>
              <label className="cashu-label" htmlFor="cashu-token-input">
                {activeCopy.tokenLabel}
              </label>
              <textarea
                id="cashu-token-input"
                className="cashu-textarea"
                value={tokenInput}
                onChange={(event) => setTokenInput(event.target.value)}
                placeholder="cashuA..."
                rows={5}
                spellCheck={false}
              />
              <div className="cashu-actions">
                <button className="primary-cta is-single" type="submit">
                  {activeCopy.showTokenButton}
                </button>
              </div>
            </form>

            {tokenErrorMessage ? (
              <p className="cashu-status cashu-status-error">
                {tokenErrorMessage}
              </p>
            ) : null}
          </div>
        </section>
      ) : (
        <section className="cashu-token-view">
          <div className="cashu-panel cashu-panel-highlight">
            <p className="cashu-page-kicker">Cashu</p>
            <div className="cashu-token-header">
              <div className="cashu-mint-chip">
                {tokenState?.iconUrl ? (
                  <img
                    className="cashu-mint-icon"
                    src={mintIconSrc}
                    alt=""
                    onError={() => {
                      setMintIconSrc(GENERIC_MINT_ICON_DATA_URL);
                    }}
                  />
                ) : null}
                <div className="cashu-token-copy">
                  <h1>
                    <button
                      type="button"
                      className={
                        tokenState?.isValid
                          ? "cashu-token-amount"
                          : "cashu-token-amount is-spent"
                      }
                      aria-label={activeCopy.currencyLabel}
                      title={activeCopy.currencyLabel}
                      onClick={cycleDisplayCurrency}
                    >
                      {displayedTokenAmountText}
                    </button>
                  </h1>
                  {tokenState?.mintHost ? (
                    <p className="cashu-mint-subtle">{tokenState.mintHost}</p>
                  ) : null}
                </div>
              </div>

              {tokenState?.isValid && !isInspecting ? (
                <button
                  type="button"
                  className="primary-cta is-single cashu-header-cta"
                  aria-label={activeCopy.openInWalletLabel}
                  title={activeCopy.openInWalletLabel}
                  onClick={handleOpenInWallet}
                >
                  {activeCopy.linkyPrimaryAction}
                </button>
              ) : null}
            </div>

            {isInspecting ? (
              <p className="cashu-status">{activeCopy.loadingToken}</p>
            ) : tokenState ? (
              <>
                {!tokenState.isValid ? (
                  <>
                    <p className="cashu-spent-badge">
                      {activeCopy.statusSpent}
                    </p>
                    <p className="cashu-status">{activeCopy.spentInfo}</p>
                  </>
                ) : (
                  <>
                    <p className="cashu-status">{activeCopy.payoutIntro}</p>

                    <div className="cashu-primary-actions">
                      <button
                        type="button"
                        className="cashu-text-button"
                        onClick={() => {
                          setIsAdditionalOptionsVisible((prev) => !prev);
                        }}
                        aria-expanded={isAdditionalOptionsVisible}
                      >
                        {isAdditionalOptionsVisible
                          ? activeCopy.collapseOptionsLabel
                          : activeCopy.expandOptionsLabel}
                      </button>
                    </div>

                    {isAdditionalOptionsVisible ? (
                      <div className="cashu-additional-options">
                        <div className="cashu-option-column">
                          <p className="cashu-label cashu-option-title">
                            {activeCopy.lightningAddressLabel}
                          </p>
                          <p className="cashu-option-description">
                            {activeCopy.lightningOptionDescription}
                          </p>
                          <form
                            className="cashu-form cashu-redeem-form"
                            onSubmit={handleRedeemSubmit}
                          >
                            <input
                              id="cashu-ln-address"
                              className="cashu-input"
                              type="text"
                              inputMode="email"
                              autoCapitalize="none"
                              autoCorrect="off"
                              value={lightningAddress}
                              onChange={(event) => {
                                setLightningAddress(event.target.value);
                                if (redeemError) {
                                  setRedeemError(null);
                                }
                              }}
                              placeholder={
                                activeCopy.lightningAddressPlaceholder
                              }
                              aria-label={activeCopy.lightningAddressLabel}
                            />
                            <button
                              className="secondary-cta"
                              type="submit"
                              disabled={
                                !tokenState.isValid ||
                                isRedeeming ||
                                !isLightningAddress(lightningAddress.trim())
                              }
                            >
                              {isRedeeming
                                ? activeCopy.redeeming
                                : activeCopy.redeemButton}
                            </button>
                            {redeemError ? (
                              <p className="cashu-status cashu-status-error">
                                {redeemError}
                              </p>
                            ) : null}
                          </form>
                        </div>

                        <div className="cashu-option-column cashu-option-column-qr">
                          <p className="cashu-label cashu-option-title">
                            {activeCopy.cashuLabel}
                          </p>
                          <p className="cashu-option-description">
                            {activeCopy.cashuOptionDescription}
                          </p>
                          {tokenQr ? (
                            <button
                              type="button"
                              className="cashu-qr-button"
                              onClick={() => {
                                void handleCopyToken();
                              }}
                              aria-label={activeCopy.cashuLabel}
                              title={activeCopy.cashuLabel}
                            >
                              <img
                                className="cashu-token-qr"
                                src={tokenQr}
                                alt="Cashu token QR"
                              />
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </>
                )}
              </>
            ) : tokenErrorMessage ? (
              <p className="cashu-status cashu-status-error">
                {tokenErrorMessage}
              </p>
            ) : (
              <p className="cashu-status">{activeCopy.noTokenLoaded}</p>
            )}
          </div>
        </section>
      )}

      <SiteFooter
        githubLabel={activeCopy.githubLabel}
        nostrLabel={activeCopy.nostrLabel}
        privacyLabel={activeCopy.privacyLabel}
      />
    </main>
  );
}
export default CashuPage;
