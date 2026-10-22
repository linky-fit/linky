import type { MintUrl } from "@linky-fit/linkshu";
import {
  Button,
  Card,
  IconButton,
  ListRow,
  Notice,
  Sheet,
  Stack,
  Text,
  TextField,
} from "@linky-fit/ui";
import { Result } from "effect";
import { useState } from "react";
import { copy } from "../copy/en";
import {
  parseLightningTarget,
  parseSats,
  sourceMint,
  type LightningTarget,
  type MintFunds,
} from "../domain/wallet";
import { formatSats, shorten } from "../format";
import { pasteText } from "../platform/clipboard";
import type {
  LightningFailure,
  LightningOutcome,
  LightningQuote,
} from "../services/lightningPayments";
import { useAppServices } from "../services/react";
import { MintField } from "./WalletParts";

type Step =
  | { readonly kind: "form" }
  | { readonly kind: "review"; readonly quote: LightningQuote }
  | { readonly kind: "done"; readonly outcome: LightningOutcome };

const recipientOf = (target: LightningTarget) =>
  target.kind === "invoice" ? shorten(target.invoice, 24) : target.target;

/**
 * Pays a Lightning invoice or address from one mint: paste the target (and an
 * amount for an address), review the amount and the most the fees take, pay.
 */
export function PayLightningSheet({
  open,
  onOpenChange,
  funds,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly funds: readonly MintFunds[];
}) {
  const { lightning } = useAppServices();
  const [picked, setPicked] = useState<MintUrl | null>(null);
  const source = sourceMint(funds, picked);
  const [step, setStep] = useState<Step>({ kind: "form" });
  const [targetText, setTargetText] = useState("");
  const [amountText, setAmountText] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<LightningFailure | null>(null);

  const close = () => {
    onOpenChange(false);
    setStep({ kind: "form" });
    setTargetText("");
    setAmountText("");
    setSubmitted(false);
    setFailure(null);
    setPicked(null);
  };
  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setFailure(null);
    try {
      await task();
    } finally {
      setBusy(false);
    }
  };

  const form = (from: MintFunds) => {
    const target = parseLightningTarget(targetText);
    const typedAmount = parseSats(amountText);
    const amount = target?.kind === "invoice" ? target.amountSats : typedAmount;
    const targetError =
      target === null && (submitted || targetText.trim() !== "")
        ? copy.wallet.targetInvalid
        : undefined;
    const amountError =
      target?.kind !== "address" || (!submitted && amountText.trim() === "")
        ? undefined
        : typedAmount === null
          ? copy.wallet.amountInvalid
          : typedAmount > from.sats
            ? copy.wallet.amountTooHigh(formatSats(from.sats))
            : undefined;
    const review = () =>
      run(async () => {
        setSubmitted(true);
        if (target === null || amount === null || amountError !== undefined)
          return;
        const quoted = await lightning.quote(target, from, amount);
        if (Result.isFailure(quoted)) setFailure(quoted.failure);
        else setStep({ kind: "review", quote: quoted.success });
      });
    const paste = async () => {
      const text = await pasteText();
      if (text !== null) setTargetText(text.trim());
    };
    return (
      <Stack gap="$lg" testID="pay-lightning-form">
        <MintField funds={funds} source={from} onPick={setPicked} />
        <TextField
          testID="pay-lightning-target"
          label={copy.wallet.invoiceField}
          placeholder={copy.wallet.invoicePlaceholder}
          value={targetText}
          onChangeText={setTargetText}
          autoCapitalize="none"
          autoCorrect={false}
          error={targetError}
          hint={
            target?.kind === "invoice"
              ? copy.wallet.invoiceAmount(formatSats(target.amountSats))
              : copy.wallet.available(formatSats(from.sats))
          }
          trailing={
            <IconButton
              icon="ClipboardPaste"
              size="sm"
              accessibilityLabel={copy.wallet.paste}
              onPress={() => void paste()}
            />
          }
        />
        {target?.kind === "address" ? (
          <TextField
            testID="pay-lightning-amount"
            label={copy.wallet.amount}
            value={amountText}
            onChangeText={setAmountText}
            inputMode="numeric"
            trailing="sat"
            error={amountError}
          />
        ) : null}
        <Button
          testID="pay-lightning-review"
          loading={busy}
          onPress={() => void review()}
        >
          {copy.wallet.review}
        </Button>
      </Stack>
    );
  };

  const reviewStep = (quote: LightningQuote) => {
    const { amount } = quote.cost.quote;
    const pay = () =>
      run(async () => {
        const paid = await lightning.pay(quote);
        if (Result.isFailure(paid)) setFailure(paid.failure);
        else setStep({ kind: "done", outcome: paid.success });
      });
    return (
      <Stack gap="$lg" testID="pay-lightning-review-step">
        <Card outlined gap="$none">
          <ListRow title={copy.wallet.to} value={recipientOf(quote.target)} />
          <ListRow title={copy.wallet.mint} value={quote.cost.quote.mint} />
          <ListRow title={copy.wallet.receives} value={formatSats(amount)} />
          <ListRow
            title={copy.wallet.feeReserve}
            value={formatSats(quote.cost.maxTotal - amount)}
          />
          <ListRow
            title={copy.wallet.maxTotal}
            value={formatSats(quote.cost.maxTotal)}
          />
        </Card>
        <Stack gap="$sm">
          <Button
            testID="pay-lightning-pay"
            icon="Zap"
            loading={busy}
            onPress={() => void pay()}
          >
            {copy.wallet.pay}
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onPress={() => {
              setFailure(null);
              setStep({ kind: "form" });
            }}
          >
            {copy.wallet.back}
          </Button>
        </Stack>
      </Stack>
    );
  };

  const doneStep = (outcome: LightningOutcome) => (
    <Stack gap="$lg" testID="pay-lightning-done">
      {outcome.status === "paid" ? (
        <Notice
          tone="accent"
          icon="Check"
          title={copy.wallet.paidTitle(formatSats(outcome.receipt.paidAmount))}
          description={copy.wallet.paidDetail(
            formatSats(outcome.receipt.feePaid + outcome.receipt.swapFee),
          )}
        />
      ) : (
        <Notice
          tone="warning"
          icon="Clock"
          title={copy.wallet.pendingTitle}
          description={copy.wallet.pendingDetail}
        />
      )}
      <Button onPress={close}>{copy.wallet.done}</Button>
    </Stack>
  );

  const body = () => {
    switch (step.kind) {
      case "form":
        return source === null ? (
          <Text color="$colorMuted">{copy.wallet.noFunds}</Text>
        ) : (
          form(source)
        );
      case "review":
        return reviewStep(step.quote);
      case "done":
        return doneStep(step.outcome);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={copy.wallet.payLightning}
    >
      <Stack gap="$lg" paddingTop="$sm" testID="pay-lightning-sheet">
        {failure === null ? null : (
          <Notice
            tone="danger"
            icon="CircleAlert"
            title={copy.wallet.paymentFailed(failure)}
          />
        )}
        {body()}
      </Stack>
    </Sheet>
  );
}
