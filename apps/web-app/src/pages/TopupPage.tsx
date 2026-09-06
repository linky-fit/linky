import {
  CircleEllipsis as NoAmountIcon,
  Copy as PasteIcon,
} from "lucide-react";
import type { FC } from "react";
import { useAppShellActions } from "../app/context/AppShellContexts";
import { AmountDisplay } from "../components/AmountDisplay";

import { Keypad } from "../components/Keypad";
import { useAmountInputKeypad } from "../components/useAmountInputKeypad";
import { navigateTo } from "../hooks/useRouting";
import type { Translate } from "../i18n";

interface TopupPageProps {
  currentNpub: string | null;
  displayUnit: string;
  setTopupAmount: (value: string | ((prev: string) => string)) => void;
  t: Translate;
  topupAmount: string;
  topupInvoiceIsBusy: boolean;
}

export const TopupPage: FC<TopupPageProps> = ({
  currentNpub,
  displayUnit,
  setTopupAmount,
  t,
  topupAmount,
  topupInvoiceIsBusy,
}) => {
  const { pasteScanValue } = useAppShellActions();

  const amountSat = Number.parseInt(topupAmount.trim(), 10);
  const invalid =
    !currentNpub ||
    !Number.isFinite(amountSat) ||
    amountSat <= 0 ||
    topupInvoiceIsBusy;
  const amountInput = useAmountInputKeypad({
    amount: topupAmount,
    onAmountChange: (nextAmount) => setTopupAmount(nextAmount),
  });
  const pasteAmountOrScanValue = async () => {
    if (await amountInput.pasteFromClipboard()) return;
    await pasteScanValue();
  };

  return (
    <section className="panel">
      <AmountDisplay
        amount={topupAmount}
        cycleOnClick
        inputDisplayValue={amountInput.inputDisplayValue}
      />

      <Keypad
        ariaLabel={`${t("payAmount")} (${displayUnit})`}
        decimalKeyEnabled={amountInput.decimalKeyEnabled}
        disabled={topupInvoiceIsBusy}
        onKeyPress={(key: string) => {
          if (topupInvoiceIsBusy) return;
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
            if (invalid) return;
            navigateTo({ route: "topupInvoice" });
          }}
          disabled={invalid}
          data-guide="topup-show-invoice"
        >
          {t("topupShowInvoice")}
        </button>

        <div className="topup-secondary-actions">
          <button
            type="button"
            className="btn-wide secondary"
            onClick={() => navigateTo({ route: "topupNoAmount" })}
          >
            <span className="btn-label-with-icon">
              <span className="btn-label-icon" aria-hidden="true">
                <NoAmountIcon size={18} />
              </span>
              <span>{t("topupNoAmount")}</span>
            </span>
          </button>
          <button
            type="button"
            className="btn-wide secondary"
            onClick={() => void pasteAmountOrScanValue()}
          >
            <span className="btn-label-with-icon">
              <span className="btn-label-icon" aria-hidden="true">
                <PasteIcon size={18} />
              </span>
              <span>{t("paste")}</span>
            </span>
          </button>
        </div>
      </div>
    </section>
  );
};
