import {
  Button,
  Card,
  IconButton,
  ListRow,
  Notice,
  Row,
  Sheet,
  Stack,
  TextField,
} from "@linky-fit/ui";
import { Result } from "effect";
import { useState } from "react";
import { copy } from "../copy";
import { satsToCzk, type WithdrawTarget } from "../domain";
import { formatCzkValue, formatWhole, shorten } from "../format";
import { pasteText } from "../platform/clipboard";
import type {
  WithdrawalOutcome,
  WithdrawalQuote,
  WithdrawFailure,
} from "../services/withdrawals";
import { useAppServices } from "../services/react";
import { DetailRows } from "./DetailRows";
import { QrScanner } from "./QrScanner";
import {
  acceptsTarget,
  readWithdrawForm,
  type WithdrawChoice,
} from "./withdrawForm";

type Step =
  | { readonly kind: "choose" }
  | { readonly kind: "form"; readonly choice: WithdrawChoice }
  | {
      readonly kind: "review";
      readonly choice: WithdrawChoice;
      readonly quote: WithdrawalQuote;
    }
  | { readonly kind: "done"; readonly outcome: WithdrawalOutcome };

const choiceTitles: Record<WithdrawChoice, string> = {
  linky: copy.withdraw.chooseLinky,
  lightning: copy.withdraw.chooseLightning,
};

const recipientOf = (target: WithdrawTarget): string => {
  switch (target.kind) {
    case "cashu_chat":
      return shorten(target.npub, 24);
    case "lightning_invoice":
      return shorten(target.invoice, 24);
    case "lightning_address":
      return target.target;
  }
};

/**
 * Sends sats out of the wallet: pick Linky or Lightning, name the recipient
 * (typed, pasted or scanned), review the amount and the most the fees take,
 * then send. Without an amount the whole balance goes, fees deducted.
 */
export function WithdrawSheet({
  open,
  onOpenChange,
  spendable,
  czkPerBtc,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The sats one withdrawal can spend: the balance of the richest mint. */
  readonly spendable: number;
  readonly czkPerBtc: number | null;
}) {
  const { withdrawals } = useAppServices();
  const [step, setStep] = useState<Step>({ kind: "choose" });
  const [targetText, setTargetText] = useState("");
  const [amountText, setAmountText] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<WithdrawFailure | null>(null);

  const reset = () => {
    setStep({ kind: "choose" });
    setTargetText("");
    setAmountText("");
    setSubmitted(false);
    setScanning(false);
    setFailure(null);
  };
  const close = () => {
    onOpenChange(false);
    reset();
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

  const sats = (value: number) => copy.satAmount(formatWhole(value));
  const withCzk = (value: number) =>
    czkPerBtc === null
      ? sats(value)
      : `${sats(value)} (${copy.approxCzk(
          formatCzkValue(satsToCzk(value, czkPerBtc)),
        )})`;

  const body = () => {
    switch (step.kind) {
      case "choose":
        return (
          <Card
            backgroundColor="$neutralSoft"
            paddingVertical="$sm"
            gap="$xs"
            testID="withdraw-choose"
          >
            <ListRow
              testID="withdraw-linky"
              icon="Send"
              title={copy.withdraw.chooseLinky}
              description={copy.withdraw.chooseLinkyDescription}
              onPress={() => setStep({ kind: "form", choice: "linky" })}
            />
            <ListRow
              testID="withdraw-lightning"
              icon="Zap"
              title={copy.withdraw.chooseLightning}
              description={copy.withdraw.chooseLightningDescription}
              onPress={() => setStep({ kind: "form", choice: "lightning" })}
            />
          </Card>
        );
      case "form": {
        const { choice } = step;
        const form = readWithdrawForm(
          choice,
          targetText,
          amountText,
          submitted,
        );
        const review = () =>
          run(async () => {
            setSubmitted(true);
            if (!form.ready || form.target === null) return;
            const quoted = await withdrawals.quote(form.target, {
              amountSats: form.amountSats,
            });
            if (Result.isFailure(quoted)) setFailure(quoted.failure);
            else setStep({ kind: "review", choice, quote: quoted.success });
          });
        const paste = async () => {
          const text = await pasteText();
          if (text !== null) setTargetText(text.trim());
        };
        const available = copy.withdraw.available(formatWhole(spendable));
        return (
          <Stack gap="$lg" testID="withdraw-form">
            {scanning ? (
              <QrScanner
                onScan={(text) => {
                  if (!acceptsTarget(choice, text)) return false;
                  setTargetText(text);
                  setScanning(false);
                  return true;
                }}
              />
            ) : null}
            <TextField
              testID="withdraw-target"
              label={
                choice === "linky"
                  ? copy.withdraw.linkyRecipient
                  : copy.withdraw.lightningTarget
              }
              placeholder={
                choice === "linky"
                  ? copy.withdraw.linkyRecipientPlaceholder
                  : copy.withdraw.lightningTargetPlaceholder
              }
              hint={
                form.targetHint ??
                (choice === "linky"
                  ? copy.withdraw.linkyRecipientHint
                  : undefined)
              }
              error={form.targetError}
              value={targetText}
              onChangeText={setTargetText}
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect={false}
              spellCheck={false}
              trailing={
                <Row gap="$xs">
                  <IconButton
                    icon="ClipboardPaste"
                    size="sm"
                    accessibilityLabel={copy.withdraw.paste}
                    onPress={() => void paste()}
                  />
                  <IconButton
                    testID="withdraw-scan"
                    icon={scanning ? "X" : "ScanLine"}
                    size="sm"
                    accessibilityLabel={
                      scanning ? copy.close : copy.withdraw.scan
                    }
                    onPress={() => setScanning((current) => !current)}
                  />
                </Row>
              }
            />
            {form.amountEditable ? (
              <TextField
                testID="withdraw-amount"
                label={copy.withdraw.amount}
                placeholder={formatWhole(spendable)}
                value={amountText}
                onChangeText={setAmountText}
                inputMode="numeric"
                trailing={copy.sat}
                error={form.amountError}
                hint={
                  form.amountSats === undefined
                    ? `${copy.withdraw.amountWhole} · ${available}`
                    : czkPerBtc === null
                      ? available
                      : copy.withdraw.amountHint(
                          formatCzkValue(satsToCzk(form.amountSats, czkPerBtc)),
                          formatWhole(spendable),
                        )
                }
              />
            ) : null}
            <Stack gap="$sm">
              <Button
                testID="withdraw-review"
                loading={busy}
                onPress={() => void review()}
              >
                {copy.withdraw.review}
              </Button>
              <Button variant="ghost" disabled={busy} onPress={reset}>
                {copy.back}
              </Button>
            </Stack>
          </Stack>
        );
      }
      case "review": {
        const { quote, choice } = step;
        const send = () =>
          run(async () => {
            const executed = await withdrawals.execute(quote);
            if (Result.isFailure(executed)) setFailure(executed.failure);
            else setStep({ kind: "done", outcome: executed.success });
          });
        return (
          <Stack gap="$lg" testID="withdraw-review-step">
            <Card backgroundColor="$neutralSoft">
              <DetailRows
                details={[
                  { label: copy.withdraw.to, value: recipientOf(quote.target) },
                  {
                    label: copy.withdraw.receives,
                    value: withCzk(quote.amountSats),
                  },
                  { label: copy.withdraw.fee, value: sats(quote.feeSats) },
                  { label: copy.withdraw.total, value: sats(quote.totalSats) },
                ]}
              />
            </Card>
            <Stack gap="$sm">
              <Button
                testID="withdraw-submit"
                icon={choice === "linky" ? "Send" : "Zap"}
                loading={busy}
                onPress={() => void send()}
              >
                {copy.withdraw.submit}
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onPress={() => {
                  setFailure(null);
                  setStep({ kind: "form", choice });
                }}
              >
                {copy.back}
              </Button>
            </Stack>
          </Stack>
        );
      }
      case "done": {
        const { status, withdrawal } = step.outcome;
        const linky = withdrawal.kind === "cashu_chat";
        const amount = formatWhole(withdrawal.amountSats);
        return (
          <Stack gap="$lg" testID="withdraw-done">
            {status === "done" || linky ? (
              <Notice
                tone="accent"
                title={copy.withdraw.sentTitle}
                description={
                  linky
                    ? copy.withdraw.linkySentDetail(amount)
                    : copy.withdraw.sentDetail(amount)
                }
              />
            ) : (
              <Notice
                tone="warning"
                title={copy.withdraw.pendingTitle}
                description={copy.withdraw.pendingDetail}
              />
            )}
            <Button testID="withdraw-close" onPress={close}>
              {copy.done}
            </Button>
          </Stack>
        );
      }
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={
        step.kind === "form" || step.kind === "review"
          ? choiceTitles[step.choice]
          : copy.withdraw.title
      }
    >
      <Stack gap="$lg" paddingTop="$sm" testID="withdraw-sheet">
        {failure ? (
          <Notice tone="danger" title={copy.withdraw.failures[failure]} />
        ) : null}
        {body()}
      </Stack>
    </Sheet>
  );
}
