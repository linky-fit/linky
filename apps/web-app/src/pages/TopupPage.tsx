import { useAtomValue } from "@linky-fit/linkstr-react";
import { Button, Row, Stack } from "@linky-fit/ui";
import type { FC } from "react";
import { useTranslation } from "../app/hooks/shell";
import { useTopupInvoice } from "../app/hooks/topup/useTopupFlow";
import { currentNpubAtom } from "../app/state/session/session";
import { AmountKeypad } from "../components/AmountKeypad";
import { PaymentNoteInput } from "../components/PaymentNoteInput";
import { useAmountInputKeypad } from "../components/useAmountInputKeypad";
import { navigateTo } from "../hooks/useRouting";

interface TopupPageProps {
  pasteScanValue: () => Promise<void>;
}

export const TopupPage: FC<TopupPageProps> = ({ pasteScanValue }) => {
  const { t } = useTranslation();
  const currentNpub = useAtomValue(currentNpubAtom);
  const {
    setTopupAmount,
    setTopupNote,
    topupAmount,
    topupInvoiceIsBusy,
    topupNote,
  } = useTopupInvoice();

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
    <Stack gap="$md">
      <AmountKeypad
        amount={topupAmount}
        input={amountInput}
        disabled={topupInvoiceIsBusy}
        below={
          <PaymentNoteInput
            disabled={topupInvoiceIsBusy}
            onChange={setTopupNote}
            t={t}
            value={topupNote}
          />
        }
      />

      <Button
        onPress={() => {
          if (invalid) return;
          navigateTo({ route: "topupInvoice" });
        }}
        disabled={invalid}
        data-guide="topup-show-invoice"
      >
        {t("topupShowInvoice")}
      </Button>

      <Row>
        <Button
          variant="secondary"
          icon="CircleEllipsis"
          flex={1}
          onPress={() => navigateTo({ route: "topupNoAmount" })}
        >
          {t("topupNoAmount")}
        </Button>
        <Button
          variant="secondary"
          icon="ClipboardPaste"
          flex={1}
          onPress={() => void pasteAmountOrScanValue()}
        >
          {t("paste")}
        </Button>
      </Row>
    </Stack>
  );
};
