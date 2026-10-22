import { encodeNpub } from "@linky-fit/linkstr";
import { Notice, Stack, Text, TextField } from "@linky-fit/ui";
import React from "react";
import { useExactAmountText } from "../app/hooks/useExactAmountText";
import type { PendingCashuPaymentRequest } from "../app/state/shell/confirmations";
import type { Translate } from "../i18n";
import { formatShortNpub } from "../utils/formatting";
import { formatMintHost } from "../utils/mint";
import { PaymentConfirmDialog } from "./PaymentConfirmDialog";

interface CashuPaymentRequestConfirmModalProps {
  cashuIsBusy: boolean;
  confirmation: PendingCashuPaymentRequest;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  onEnterAmount: (amountSat: number) => Promise<void>;
  t: Translate;
}

const hostOf = (rawUrl: string): string | null => {
  try {
    return new URL(rawUrl).host || null;
  } catch {
    return null;
  }
};

const caption = (text: string) => (
  <Text variant="caption" bold color="$colorMuted" textAlign="center">
    {text}
  </Text>
);

export function CashuPaymentRequestConfirmModal({
  cashuIsBusy,
  confirmation,
  onClose,
  onConfirm,
  onEnterAmount,
  t,
}: CashuPaymentRequestConfirmModalProps) {
  const { exact, fiat, satParts } = useExactAmountText();
  const [amountText, setAmountText] = React.useState("");
  const {
    insufficientAmount,
    quote,
    recipientDiffers,
    recipientName,
    request,
    summary,
  } = confirmation;
  const description = summary ?? request.description;

  const recipient =
    recipientName ||
    (request.transportPubkeyHex !== null
      ? formatShortNpub(encodeNpub(request.transportPubkeyHex))
      : request.transportPostUrl !== null
        ? (hostOf(request.transportPostUrl) ?? request.transportPostUrl)
        : null);
  const paymentMint =
    quote === null
      ? null
      : formatMintHost(quote._tag === "Direct" ? quote.mint : quote.targetMint);
  const insecureTransport =
    request.transportPubkeyHex === null &&
    (request.transportPostUrl ?? "").toLowerCase().startsWith("http://");

  const meta = (
    <Stack alignItems="center" gap="$xxs">
      {quote === null ? (
        <TextField
          label={t("payAmount")}
          inputMode="numeric"
          trailing="sat"
          value={amountText}
          onChangeText={(text) => setAmountText(text.replace(/\D/g, ""))}
        />
      ) : null}
      {recipient
        ? caption(
            t("paymentRequestConfirmRecipient").replace(
              "{recipient}",
              recipient,
            ),
          )
        : null}
      {paymentMint
        ? caption(t("paymentRequestConfirmMint").replace("{mint}", paymentMint))
        : null}
      {quote !== null && quote.fee > 0 ? (
        <>
          {caption(t("paymentRequestFees").replace("{fee}", exact(quote.fee)))}
          {caption(
            t("paymentRequestMaxTotal").replace(
              "{total}",
              exact(quote.amount + quote.fee),
            ),
          )}
        </>
      ) : null}
      {quote?._tag === "Lightning" && quote.addsMint && paymentMint ? (
        <Notice
          tone="accent"
          title={t("paymentRequestAddMint").replace("{mint}", paymentMint)}
        />
      ) : null}
      {recipientDiffers && recipient ? (
        <Notice
          tone="danger"
          title={t("paymentRequestOtherRecipient").replace(
            "{recipient}",
            recipient,
          )}
        />
      ) : null}
      {insecureTransport ? (
        <Notice
          tone="danger"
          title={t("paymentRequestInsecureTransportWarning")}
        />
      ) : null}
    </Stack>
  );

  if (quote === null) {
    const enteredAmount = Number.parseInt(amountText, 10);
    const validAmount = Number.isFinite(enteredAmount) && enteredAmount > 0;
    const insufficient = validAmount && enteredAmount === insufficientAmount;
    return (
      <PaymentConfirmDialog
        amountSat={null}
        unknownAmountLabel={t("paymentRequestEnterAmount")}
        label={t("paymentRequestConfirmTitle")}
        confirmLabel={t("continue")}
        cancelLabel={t("payCancel")}
        description={description}
        meta={meta}
        isBusy={cashuIsBusy}
        disabled={!validAmount || insufficient}
        {...(insufficient ? { disabledReason: t("payInsufficient") } : {})}
        onClose={onClose}
        onConfirm={() => onEnterAmount(enteredAmount)}
      />
    );
  }

  const amountFiat = fiat(quote.amount);
  return (
    <PaymentConfirmDialog
      amountSat={quote.amount}
      amountParts={amountFiat === null ? undefined : satParts(quote.amount)}
      amountCaption={amountFiat ?? undefined}
      label={t("paymentRequestConfirmTitle")}
      confirmLabel={t("paySend")}
      cancelLabel={t("payCancel")}
      description={description}
      meta={meta}
      isBusy={cashuIsBusy}
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
}
