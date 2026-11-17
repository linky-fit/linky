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
  LINKY_NAME_DOMAIN,
  parseSats,
  parseSendTarget,
  sourceMint,
  type LightningTarget,
  type MintFunds,
  type SendTarget,
} from "../domain/wallet";
import { formatSats, shortNpub, shorten } from "../format";
import { pasteText } from "../platform/clipboard";
import type { CashuRecipient, CashuSendFailure } from "../services/cashuSends";
import type {
  LightningFailure,
  LightningOutcome,
  LightningQuote,
} from "../services/lightningPayments";
import { useAppServices } from "../services/react";
import { MintField } from "./WalletParts";

interface CashuReview {
  readonly recipient: CashuRecipient;
  readonly label: string;
  readonly source: MintFunds;
  readonly amount: number;
}

type Step =
  | { readonly kind: "form" }
  | { readonly kind: "review"; readonly quote: LightningQuote }
  | { readonly kind: "reviewCashu"; readonly review: CashuReview }
  | { readonly kind: "done"; readonly outcome: LightningOutcome }
  | { readonly kind: "sentCashu"; readonly review: CashuReview };

type Failure =
  | { readonly rail: "lightning"; readonly failure: LightningFailure }
  | { readonly rail: "cashu"; readonly failure: CashuSendFailure };

const recipientOf = (target: LightningTarget) =>
  target.kind === "invoice" ? shorten(target.invoice, 24) : target.target;

/** Whether the target needs a typed amount: all but an invoice, which names its own. */
const needsAmount = (target: SendTarget | null) =>
  target !== null &&
  !(target.kind === "lightning" && target.target.kind === "invoice");

/**
 * Sends Cashu from one mint: to an npub or a Linky name as a token in a Nostr
 * message, or over Lightning to an invoice or address after reviewing the
 * most the fees take.
 */
export function SendSheet({
  open,
  onOpenChange,
  funds,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly funds: readonly MintFunds[];
}) {
  const { lightning, cashuSends } = useAppServices();
  const [picked, setPicked] = useState<MintUrl | null>(null);
  const source = sourceMint(funds, picked);
  const [step, setStep] = useState<Step>({ kind: "form" });
  const [targetText, setTargetText] = useState("");
  const [amountText, setAmountText] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

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
    const target = parseSendTarget(targetText);
    const typedAmount = parseSats(amountText);
    const amount =
      target?.kind === "lightning" && target.target.kind === "invoice"
        ? target.target.amountSats
        : typedAmount;
    const targetError =
      target === null && (submitted || targetText.trim() !== "")
        ? copy.wallet.targetInvalid
        : undefined;
    const amountError =
      !needsAmount(target) || (!submitted && amountText.trim() === "")
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
        if (target.kind === "lightning") {
          const quoted = await lightning.quote(target.target, from, amount);
          if (Result.isFailure(quoted))
            setFailure({ rail: "lightning", failure: quoted.failure });
          else setStep({ kind: "review", quote: quoted.success });
          return;
        }
        if (target.kind === "npub") {
          setStep({
            kind: "reviewCashu",
            review: {
              recipient: { pubkey: target.pubkey, relays: [] },
              label: shortNpub(target.pubkey),
              source: from,
              amount,
            },
          });
          return;
        }
        const resolved = await cashuSends.resolveName(target.name);
        if (Result.isFailure(resolved))
          setFailure({ rail: "cashu", failure: resolved.failure });
        else
          setStep({
            kind: "reviewCashu",
            review: {
              recipient: resolved.success,
              label: `${target.name}@${LINKY_NAME_DOMAIN}`,
              source: from,
              amount,
            },
          });
      });
    const paste = async () => {
      const text = await pasteText();
      if (text !== null) setTargetText(text.trim());
    };
    return (
      <Stack gap="$lg" testID="send-form">
        <MintField funds={funds} source={from} onPick={setPicked} />
        <TextField
          testID="send-target"
          label={copy.wallet.recipientField}
          placeholder={copy.wallet.recipientPlaceholder}
          value={targetText}
          onChangeText={setTargetText}
          autoCapitalize="none"
          autoCorrect={false}
          error={targetError}
          hint={
            target?.kind === "lightning" && target.target.kind === "invoice"
              ? copy.wallet.invoiceAmount(formatSats(target.target.amountSats))
              : target?.kind === "npub" || target?.kind === "linkyName"
                ? copy.wallet.asCashu(formatSats(from.sats))
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
        {needsAmount(target) ? (
          <TextField
            testID="send-amount"
            label={copy.wallet.amount}
            value={amountText}
            onChangeText={setAmountText}
            inputMode="numeric"
            trailing="sat"
            error={amountError}
          />
        ) : null}
        <Button
          testID="send-review"
          loading={busy}
          onPress={() => void review()}
        >
          {copy.wallet.review}
        </Button>
      </Stack>
    );
  };

  const backButton = (
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
  );

  const reviewStep = (quote: LightningQuote) => {
    const { amount } = quote.cost.quote;
    const pay = () =>
      run(async () => {
        const paid = await lightning.pay(quote);
        if (Result.isFailure(paid))
          setFailure({ rail: "lightning", failure: paid.failure });
        else setStep({ kind: "done", outcome: paid.success });
      });
    return (
      <Stack gap="$lg" testID="send-review-step">
        <Card backgroundColor="$surfaceRaised" gap="$none">
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
            testID="send-pay"
            icon="Zap"
            loading={busy}
            onPress={() => void pay()}
          >
            {copy.wallet.pay}
          </Button>
          {backButton}
        </Stack>
      </Stack>
    );
  };

  const reviewCashuStep = (review: CashuReview) => {
    const send = () =>
      run(async () => {
        const sent = await cashuSends.send(
          review.recipient,
          review.source,
          review.amount,
        );
        if (Result.isFailure(sent))
          setFailure({ rail: "cashu", failure: sent.failure });
        else setStep({ kind: "sentCashu", review });
      });
    return (
      <Stack gap="$lg" testID="send-review-cashu">
        <Card backgroundColor="$surfaceRaised" gap="$none">
          <ListRow title={copy.wallet.to} value={review.label} />
          <ListRow title={copy.wallet.mint} value={review.source.mint} />
          <ListRow
            title={copy.wallet.cashuAmount}
            value={formatSats(review.amount)}
          />
        </Card>
        <Stack gap="$sm">
          <Button
            testID="send-cashu"
            icon="Send"
            loading={busy}
            onPress={() => void send()}
          >
            {copy.wallet.sendCashu}
          </Button>
          {backButton}
        </Stack>
      </Stack>
    );
  };

  const doneStep = (outcome: LightningOutcome) => (
    <Stack gap="$lg" testID="send-done">
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

  const sentCashuStep = (review: CashuReview) => (
    <Stack gap="$lg" testID="send-done">
      <Notice
        tone="accent"
        icon="Check"
        title={copy.wallet.cashuSentTitle(
          formatSats(review.amount),
          review.label,
        )}
        description={copy.wallet.cashuSentDetail}
      />
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
      case "reviewCashu":
        return reviewCashuStep(step.review);
      case "done":
        return doneStep(step.outcome);
      case "sentCashu":
        return sentCashuStep(step.review);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={copy.wallet.send}
    >
      <Stack gap="$lg" paddingTop="$sm" testID="send-sheet">
        {failure === null ? null : (
          <Notice
            tone="danger"
            icon="CircleAlert"
            title={
              failure.rail === "lightning"
                ? copy.wallet.paymentFailed(failure.failure)
                : copy.wallet.cashuFailed(failure.failure)
            }
          />
        )}
        {body()}
      </Stack>
    </Sheet>
  );
}
