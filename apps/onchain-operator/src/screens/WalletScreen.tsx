import type { OperationId, TokenTransfer } from "@linky-fit/linkshu";
import {
  Amount,
  Button,
  IconButton,
  ListRow,
  Notice,
  Pressable,
  Row,
  Section,
  Stack,
  Text,
} from "@linky-fit/ui";
import { useEffect, useState } from "react";
import { copy } from "../copy/en";
import { fundedMints, satsToCzk } from "../domain/wallet";
import { formatDateTime, formatNumber, formatSats } from "../format";
import { useCzkPerBtc } from "../platform/czkRate";
import {
  useAppServices,
  useIssuedTokens,
  useWalletBalance,
} from "../services/react";
import type { TakeBackOutcome } from "../services/wallet";
import { Page } from "./Page";
import { SendSheet } from "./SendSheet";
import { TokenSheet } from "./TokenSheet";

/** How often the mints are asked whether a listed token was claimed. */
const CLAIM_CHECK_MS = 15_000;

type Sheet =
  | { readonly kind: "token"; readonly token: string }
  | { readonly kind: "send" };

/** The total of Cashu and the watch-only on-chain wallet, each below it, and sending Cashu out. */
export function WalletScreen() {
  const { wallet, config, onchainWallet } = useAppServices();
  // `noKey` hides the row; reading every address takes a while, so it shows `…` until then.
  const [onchain, setOnchain] = useState<
    number | "loading" | "noKey" | "failed"
  >("loading");
  useEffect(() => {
    let current = true;
    onchainWallet.balance().then(
      (sats) => {
        if (current) setOnchain(sats ?? "noKey");
      },
      (error: unknown) => {
        console.warn("[onchain-operator] on-chain balance not read", error);
        if (current) setOnchain("failed");
      },
    );
    return () => {
      current = false;
    };
  }, [onchainWallet]);
  const balances = useWalletBalance();
  const issued = useIssuedTokens() ?? [];
  const funds = fundedMints(balances, config.mintUrl);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const czkPerBtc = useCzkPerBtc();
  const [inCzk, setInCzk] = useState(false);
  const showCzk = inCzk && czkPerBtc !== null;
  const shown = (sats: number) =>
    showCzk
      ? { value: formatNumber(satsToCzk(sats, czkPerBtc)), unit: "CZK" }
      : { value: formatNumber(sats), unit: "sat" };
  const label = (sats: number) => {
    const { value, unit } = shown(sats);
    return `${value} ${unit}`;
  };
  const cashuSat = balances?.total ?? 0;
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
      <Stack alignItems="center" paddingVertical="$xl">
        <Pressable
          testID="wallet-total"
          tooltip={showCzk ? copy.wallet.showSats : copy.wallet.showCzk}
          aria-label={showCzk ? copy.wallet.showSats : copy.wallet.showCzk}
          onPress={() => setInCzk((czk) => !czk)}
        >
          <Amount
            {...shown(cashuSat + (typeof onchain === "number" ? onchain : 0))}
          />
        </Pressable>
      </Stack>
      <Section>
        <ListRow
          testID="wallet-cashu"
          icon="Bean"
          title={
            <Row gap="$sm" alignItems="center">
              <Text>{copy.wallet.cashu}</Text>
              <Button
                testID="wallet-send"
                size="sm"
                variant="secondary"
                icon="Send"
                onPress={() => setSheet({ kind: "send" })}
              >
                {copy.wallet.send}
              </Button>
            </Row>
          }
          description={
            funds.length > 1
              ? funds
                  .map(({ mint, sats }) => `${mint} ${label(sats)}`)
                  .join(" · ")
              : undefined
          }
          value={label(cashuSat)}
        />
        {onchain === "noKey" ? null : (
          <ListRow
            testID="wallet-onchain"
            icon="Bitcoin"
            title={copy.wallet.onchain}
            value={
              typeof onchain === "number"
                ? label(onchain)
                : onchain === "loading"
                  ? "…"
                  : "—"
            }
          />
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
                      setSheet({ kind: "token", token: token.tokenText })
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
      <TokenSheet
        token={sheet?.kind === "token" ? sheet.token : null}
        onClose={() => setSheet(null)}
      />
      <SendSheet
        open={sheet?.kind === "send"}
        onOpenChange={(open) => {
          if (!open) setSheet(null);
        }}
        funds={funds}
      />
    </Page>
  );
}
