import { useState, type Dispatch, type FC, type SetStateAction } from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { AmountDisplay } from "../components/AmountDisplay";
import { Keypad } from "../components/Keypad";
import { useAmountInputKeypad } from "../components/useAmountInputKeypad";

interface CashuTokenEmitPageProps {
  cashuBalance: number;
  cashuBalanceAfterMelt: number;
  cashuEmitAmount: string;
  cashuIsBusy: boolean;
  cashuMeltToMainMintButtonLabel: string | null;
  cashuHasMultipleAcceptedMints: boolean;
  displayUnit: string;
  emitCashuToken: () => Promise<void>;
  meltLargestForeignMintToMainMint: () => Promise<void>;
  setCashuEmitAmount: Dispatch<SetStateAction<string>>;
}

export const CashuTokenEmitPage: FC<CashuTokenEmitPageProps> = ({
  cashuBalance,
  cashuBalanceAfterMelt,
  cashuEmitAmount,
  cashuIsBusy,
  cashuHasMultipleAcceptedMints,
  cashuMeltToMainMintButtonLabel,
  displayUnit,
  emitCashuToken,
  meltLargestForeignMintToMainMint,
  setCashuEmitAmount,
}) => {
  const { formatDisplayedAmountText, t } = useAppShellCore();
  const [mintWarningDismissed, setMintWarningDismissed] = useState(false);
  const amountSat = Number.parseInt(cashuEmitAmount.trim(), 10);
  const invalid =
    !Number.isFinite(amountSat) ||
    amountSat <= 0 ||
    amountSat > cashuBalance ||
    cashuIsBusy;
  const canUseFullAvailableAmount = cashuBalance > 0 && !cashuIsBusy;
  const availableAmountText = `${t("availablePrefix")} ${formatDisplayedAmountText(
    cashuBalance,
  )}`;
  const showMintWarning =
    cashuHasMultipleAcceptedMints &&
    Boolean(cashuMeltToMainMintButtonLabel) &&
    Number.isFinite(amountSat) &&
    amountSat > cashuBalance &&
    amountSat <= cashuBalanceAfterMelt &&
    !mintWarningDismissed;
  const amountInput = useAmountInputKeypad({
    amount: cashuEmitAmount,
    onAmountChange: (nextAmount) => setCashuEmitAmount(nextAmount),
  });

  return (
    <>
      {showMintWarning ? (
        <div className="wallet-warning cashu-emit-mint-warning" role="alert">
          <button
            type="button"
            className="wallet-warning-close"
            onClick={() => setMintWarningDismissed(true)}
            aria-label={t("close")}
            title={t("close")}
          >
            ×
          </button>
          <span className="wallet-warning-icon" aria-hidden="true">
            !
          </span>
          <div className="wallet-warning-text">
            <span className="wallet-warning-title">
              {t("cashuMultipleMintsWarningTitle")}
            </span>
            <span className="wallet-warning-body">
              {t("cashuMultipleMintsWarningBody")}
            </span>
            <button
              type="button"
              className="btn-wide secondary"
              onClick={() => void meltLargestForeignMintToMainMint()}
              disabled={cashuIsBusy}
            >
              {cashuMeltToMainMintButtonLabel}
            </button>
          </div>
        </div>
      ) : null}

      <section className="panel">
        <div className="contact-header">
          <div className="contact-header-text">
            <h3>{t("cashuEmit")}</h3>
            <p className="muted">
              <button
                type="button"
                className="copyable available-amount-button muted"
                disabled={!canUseFullAvailableAmount}
                onClick={() => {
                  if (!canUseFullAvailableAmount) return;
                  setCashuEmitAmount(String(cashuBalance));
                }}
              >
                {availableAmountText}
              </button>
            </p>
          </div>
        </div>

        <AmountDisplay
          amount={cashuEmitAmount}
          cycleOnClick
          inputDisplayValue={amountInput.inputDisplayValue}
        />

        <Keypad
          ariaLabel={`${t("payAmount")} (${displayUnit})`}
          decimalKeyEnabled={amountInput.decimalKeyEnabled}
          disabled={cashuIsBusy}
          onKeyPress={(key: string) => {
            if (cashuIsBusy) return;
            amountInput.onKeyPress(key);
          }}
          translations={{
            clearForm: t("clearForm"),
            decimalPoint: t("decimalPoint"),
            delete: t("delete"),
          }}
        />

        <div className="actions">
          <button
            className="btn-wide"
            onClick={() => {
              void emitCashuToken();
            }}
            disabled={invalid}
            title={amountSat > cashuBalance ? t("payInsufficient") : undefined}
          >
            {t("cashuEmit")}
          </button>
        </div>
      </section>
    </>
  );
};
