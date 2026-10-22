import type { MintUrl, SendError } from "@linky-fit/linkshu";
import { Button, Notice, Sheet, Stack, Text, TextField } from "@linky-fit/ui";
import { Result } from "effect";
import { useState } from "react";
import { copy } from "../copy/en";
import { parseSats, sourceMint, type MintFunds } from "../domain/wallet";
import { formatSats } from "../format";
import { useAppServices } from "../services/react";
import { MintField, TokenView } from "./WalletParts";

/**
 * Issues a token of a typed amount and shows it to hand over; with `shownToken`
 * it shows that token, one issued earlier, instead.
 */
export function SendTokenSheet({
  open,
  onOpenChange,
  funds,
  shownToken,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly funds: readonly MintFunds[];
  readonly shownToken?: string | null | undefined;
}) {
  const { wallet } = useAppServices();
  const [picked, setPicked] = useState<MintUrl | null>(null);
  const source = sourceMint(funds, picked);
  const [amountText, setAmountText] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<SendError["_tag"] | null>(null);
  const [issued, setIssued] = useState<string | null>(null);
  const token = shownToken ?? issued;

  const close = () => {
    onOpenChange(false);
    setAmountText("");
    setSubmitted(false);
    setFailure(null);
    setIssued(null);
    setPicked(null);
  };

  const amount = parseSats(amountText);
  const amountError =
    !submitted && amountText.trim() === ""
      ? undefined
      : amount === null
        ? copy.wallet.amountInvalid
        : source !== null && amount > source.sats
          ? copy.wallet.amountTooHigh(formatSats(source.sats))
          : undefined;

  const create = async () => {
    setSubmitted(true);
    if (source === null || amount === null || amount > source.sats) return;
    setBusy(true);
    setFailure(null);
    try {
      const sent = await wallet.issueToken(source.mint, amount);
      if (Result.isFailure(sent)) setFailure(sent.failure._tag);
      else setIssued(sent.success.tokenText);
    } finally {
      setBusy(false);
    }
  };

  const form = () =>
    source === null ? (
      <Text color="$colorMuted">{copy.wallet.noFunds}</Text>
    ) : (
      <Stack gap="$lg" testID="send-token-form">
        <MintField funds={funds} source={source} onPick={setPicked} />
        <TextField
          testID="send-token-amount"
          label={copy.wallet.amount}
          value={amountText}
          onChangeText={setAmountText}
          inputMode="numeric"
          trailing="sat"
          hint={copy.wallet.available(formatSats(source.sats))}
          error={amountError}
          onSubmitEditing={() => void create()}
        />
        <Button
          testID="send-token-create"
          icon="Send"
          loading={busy}
          onPress={() => void create()}
        >
          {copy.wallet.createToken}
        </Button>
      </Stack>
    );

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={token === null ? copy.wallet.sendToken : copy.wallet.tokenTitle}
    >
      <Stack gap="$lg" paddingTop="$sm" testID="send-token-sheet">
        {failure === null ? null : (
          <Notice
            tone="danger"
            icon="CircleAlert"
            title={copy.wallet.sendFailed(failure)}
          />
        )}
        {token === null ? (
          form()
        ) : (
          <>
            <TokenView token={token} />
            <Button variant="ghost" onPress={close}>
              {copy.wallet.done}
            </Button>
          </>
        )}
      </Stack>
    </Sheet>
  );
}
