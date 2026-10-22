import type { OperationId, TokenTransfer } from "@linky-fit/linkshu";
import {
  Amount,
  Button,
  IconButton,
  ListRow,
  Notice,
  Row,
  Section,
  Stack,
  Text,
} from "@linky-fit/ui";
import { useEffect, useState } from "react";
import { copy } from "../copy/en";
import { fundedMints } from "../domain/wallet";
import { formatDateTime, formatSats } from "../format";
import {
  useAppServices,
  useIssuedTokens,
  useWalletBalance,
} from "../services/react";
import type { TakeBackOutcome } from "../services/wallet";
import { Page } from "./Page";
import { PayLightningSheet } from "./PayLightningSheet";
import { SendTokenSheet } from "./SendTokenSheet";

/** How often the mints are asked whether a listed token was claimed. */
const CLAIM_CHECK_MS = 15_000;

type Sheet =
  | { readonly kind: "send"; readonly token: string | null }
  | { readonly kind: "lightning" };

/** The operator's ecash at each mint, and moving it out: as a token or over Lightning. */
export function WalletScreen() {
  const { wallet, config } = useAppServices();
  const balances = useWalletBalance();
  const issued = useIssuedTokens() ?? [];
  const funds = fundedMints(balances, config.mintUrl);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [takingBack, setTakingBack] = useState<OperationId | null>(null);
  const [takeBack, setTakeBack] = useState<{
    readonly outcome: TakeBackOutcome;
    readonly amount: number;
  } | null>(null);

  const hasIssued = issued.length > 0;
  useEffect(() => {
    if (!hasIssued) return;
    const check = () => void wallet.checkClaims();
    check();
    const timer = setInterval(check, CLAIM_CHECK_MS);
    return () => clearInterval(timer);
  }, [hasIssued, wallet]);

  const takeBackToken = async (token: TokenTransfer) => {
    setTakingBack(token.id);
    setTakeBack(null);
    try {
      setTakeBack({
        outcome: await wallet.takeBack(token.id),
        amount: token.amount,
      });
    } finally {
      setTakingBack(null);
    }
  };

  return (
    <Page title={copy.wallet.title} testID="wallet-screen">
      <Stack alignItems="center" paddingVertical="$xl" gap="$lg">
        <Amount
          value={formatSats(balances?.total ?? 0).replace(/ sat$/u, "")}
          unit="sat"
          caption={copy.wallet.total}
        />
        <Row gap="$sm" flexWrap="wrap" justifyContent="center">
          <Button
            testID="wallet-send-token"
            icon="Send"
            variant="secondary"
            onPress={() => setSheet({ kind: "send", token: null })}
          >
            {copy.wallet.sendToken}
          </Button>
          <Button
            testID="wallet-pay-lightning"
            icon="Zap"
            variant="secondary"
            onPress={() => setSheet({ kind: "lightning" })}
          >
            {copy.wallet.payLightning}
          </Button>
        </Row>
        <Text variant="caption" color="$colorMuted" textAlign="center">
          {copy.wallet.fundsHint}
        </Text>
      </Stack>
      <Section title={copy.wallet.perMint}>
        {funds.length === 0 ? (
          <Text color="$colorMuted">{copy.wallet.empty}</Text>
        ) : (
          funds.map(({ mint, sats }) => (
            <ListRow
              key={mint}
              icon="Landmark"
              title={mint}
              value={formatSats(sats)}
            />
          ))
        )}
      </Section>
      {hasIssued || takeBack !== null ? (
        <Section title={copy.wallet.sentTokens}>
          <Text variant="caption" color="$colorMuted">
            {copy.wallet.sentTokensHint}
          </Text>
          {takeBack === null ? null : takeBack.outcome === "returned" ? (
            <Notice
              tone="accent"
              icon="Check"
              title={copy.wallet.takenBack(formatSats(takeBack.amount))}
            />
          ) : (
            <Notice
              tone={takeBack.outcome === "claimed" ? "info" : "danger"}
              icon="CircleAlert"
              title={copy.wallet.takeBackFailed[takeBack.outcome]}
            />
          )}
          {issued.map((token) => (
            <ListRow
              key={token.id}
              testID="wallet-sent-token"
              icon="Coins"
              title={formatSats(token.amount)}
              description={copy.wallet.sentAt(
                token.mint,
                formatDateTime(token.createdAt),
              )}
              trailing={
                <Row gap="$xs" alignItems="center">
                  <IconButton
                    icon="QrCode"
                    size="sm"
                    accessibilityLabel={copy.wallet.showToken}
                    onPress={() =>
                      setSheet({ kind: "send", token: token.tokenText })
                    }
                  />
                  <Button
                    testID="wallet-take-back"
                    size="sm"
                    variant="secondary"
                    loading={takingBack === token.id}
                    disabled={takingBack !== null}
                    onPress={() => void takeBackToken(token)}
                  >
                    {copy.wallet.takeBack}
                  </Button>
                </Row>
              }
            />
          ))}
        </Section>
      ) : null}
      <SendTokenSheet
        open={sheet?.kind === "send"}
        onOpenChange={(open) => {
          if (!open) setSheet(null);
        }}
        funds={funds}
        shownToken={sheet?.kind === "send" ? sheet.token : null}
      />
      <PayLightningSheet
        open={sheet?.kind === "lightning"}
        onOpenChange={(open) => {
          if (!open) setSheet(null);
        }}
        funds={funds}
      />
    </Page>
  );
}
