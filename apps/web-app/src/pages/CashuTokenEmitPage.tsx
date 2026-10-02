import { Button, Notice, Stack } from "@linky-fit/ui";
import { useState, type Dispatch, type FC, type SetStateAction } from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { AmountKeypad } from "../components/AmountKeypad";
import { PaymentNoteInput } from "../components/PaymentNoteInput";
import { useAmountInputKeypad } from "../components/useAmountInputKeypad";

interface CashuTokenEmitPageProps {
  cashuBalance: number;
  cashuBalanceAfterMelt: number;
  cashuEmitAmount: string;
  cashuIsBusy: boolean;
  cashuMeltToMainMintButtonLabel: string | null;
  cashuHasMultipleAcceptedMints: boolean;
  displayUnit: string;
  emitCashuToken: (options: { note: string | null }) => Promise<void>;
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
  emitCashuToken,
  meltLargestForeignMintToMainMint,
  setCashuEmitAmount,
}) => {
  const { formatDisplayedAmountText, t } = useAppShellCore();
  const [mintWarningDismissed, setMintWarningDismissed] = useState(false);
  const [note, setNote] = useState("");
  const amountSat = Number.parseInt(cashuEmitAmount.trim(), 10);
  const insufficient = amountSat > cashuBalance;
  const invalid =
    !Number.isFinite(amountSat) ||
    amountSat <= 0 ||
    insufficient ||
    cashuIsBusy;
  const canUseFullAvailableAmount = cashuBalance > 0 && !cashuIsBusy;
  const availableAmountText = `${t("availablePrefix")} ${formatDisplayedAmountText(
    cashuBalance,
  )}`;
  const meltLabel =
    cashuHasMultipleAcceptedMints &&
    insufficient &&
    amountSat <= cashuBalanceAfterMelt &&
    !mintWarningDismissed
      ? cashuMeltToMainMintButtonLabel
      : null;
  const amountInput = useAmountInputKeypad({
    amount: cashuEmitAmount,
    onAmountChange: (nextAmount) => setCashuEmitAmount(nextAmount),
  });

  return (
    <Stack gap="$lg">
      {meltLabel ? (
        <Notice
          tone="accent"
          icon="CircleAlert"
          title={t("cashuMultipleMintsWarningTitle")}
          description={t("cashuMultipleMintsWarningBody")}
          action={{
            label: meltLabel,
            onPress: () => void meltLargestForeignMintToMainMint(),
          }}
          dismiss={{
            label: t("close"),
            onPress: () => setMintWarningDismissed(true),
          }}
        />
      ) : null}

      <Button
        variant="ghost"
        size="sm"
        alignSelf="flex-start"
        disabled={!canUseFullAvailableAmount}
        onPress={() => setCashuEmitAmount(String(cashuBalance))}
      >
        {availableAmountText}
      </Button>

      <AmountKeypad
        amount={cashuEmitAmount}
        input={amountInput}
        disabled={cashuIsBusy}
        below={
          <PaymentNoteInput
            disabled={cashuIsBusy}
            onChange={setNote}
            t={t}
            value={note}
          />
        }
      />

      {insufficient && !meltLabel ? (
        <Notice tone="accent" icon="CircleAlert" title={t("payInsufficient")} />
      ) : null}

      <Button
        onPress={() => {
          void emitCashuToken({ note: note.trim() || null });
        }}
        disabled={invalid}
        tooltip={insufficient ? t("payInsufficient") : undefined}
      >
        {t("cashuEmit")}
      </Button>
    </Stack>
  );
};
