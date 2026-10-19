import {
  Button,
  Card,
  IconButton,
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
import { ContactField } from "./ContactField";
import { useContactLookup, type ContactState } from "./contactState";
import { DetailRows } from "./DetailRows";
import { QrScanner } from "./QrScanner";
import {
  acceptsTarget,
  needsContactLookup,
  readWithdrawForm,
} from "./withdrawForm";

type Step =
  | { readonly kind: "form" }
  | { readonly kind: "review"; readonly quote: WithdrawalQuote }
  | { readonly kind: "done"; readonly outcome: WithdrawalOutcome };

const recipientOf = (target: WithdrawTarget): string => {
  switch (target.kind) {
    case "cashu_chat":
      return target.address ?? shorten(target.npub, 24);
    case "lightning_invoice":
      return shorten(target.invoice, 24);
    case "lightning_address":
      return target.target;
  }
};

/**
 * Sends sats out of the wallet: name the recipient (a Linky name, npub or
 * profile link, a Lightning address or an invoice; typed, pasted or
 * scanned), review the amount and the most the fees take, then send.
 * Without an amount the whole balance goes, fees deducted.
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
  const [step, setStep] = useState<Step>({ kind: "form" });
  const [targetText, setTargetText] = useState("");
  const [amountText, setAmountText] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<WithdrawFailure | null>(null);
  // Only a Linky name is looked up, and only while the sheet is open.
  const lookup = useContactLookup(
    open && needsContactLookup(targetText) ? targetText : "",
  );

  const reset = () => {
    setStep({ kind: "form" });
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
      case "form": {
        const form = readWithdrawForm(
          targetText,
          lookup,
          amountText,
          submitted,
        );
        // A key named outright gets its profile shown like a looked-up one.
        const fieldState: ContactState =
          form.target?.kind === "cashu_chat"
            ? {
                kind: "resolved",
                contact: {
                  pubkey: form.target.pubkey,
                  address: form.target.address ?? null,
                },
              }
            : lookup;
        const review = () =>
          run(async () => {
            setSubmitted(true);
            if (!form.ready || form.target === null) return;
            const quoted = await withdrawals.quote(form.target, {
              amountSats: form.amountSats,
            });
            if (Result.isFailure(quoted)) setFailure(quoted.failure);
            else setStep({ kind: "review", quote: quoted.success });
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
                  if (!acceptsTarget(text)) return false;
                  setTargetText(text);
                  setScanning(false);
                  return true;
                }}
              />
            ) : null}
            <ContactField
              testID="withdraw-target"
              label={copy.withdraw.target}
              placeholder={copy.withdraw.targetPlaceholder}
              value={targetText}
              onChangeText={setTargetText}
              state={fieldState}
              hint={form.targetHint}
              error={form.targetError}
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
            <Button
              testID="withdraw-review"
              loading={busy}
              onPress={() => void review()}
            >
              {copy.withdraw.review}
            </Button>
          </Stack>
        );
      }
      case "review": {
        const { quote } = step;
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
                icon={quote.target.kind === "cashu_chat" ? "Send" : "Zap"}
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
                  setStep({ kind: "form" });
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
      title={copy.withdraw.title}
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
