import { Amount, Button, Notice, Pressable, Stack } from "@linky-fit/ui";
import { useState } from "react";
import { copy } from "../copy";
import { cashRequestMessage, satsToCzk, type ShopProfile } from "../domain";
import { formatCzkValue, formatWhole } from "../format";
import {
  useAppServices,
  useCzkRate,
  useWalletBalance,
} from "../services/react";
import { Page } from "./Page";
import { WithdrawSheet } from "./WithdrawSheet";

export function WalletScreen({ shop }: { readonly shop: ShopProfile }) {
  const balances = useWalletBalance();
  const rate = useCzkRate();
  const [withdrawing, setWithdrawing] = useState(false);
  const total = balances?.total ?? 0;
  const czkPerBtc = rate.status === "ready" ? rate.czkPerBtc : null;
  // Starts in CZK on every visit, so a merchant never lands on sats unexpectedly.
  const [showSats, setShowSats] = useState(false);
  const czk = showSats ? null : czkPerBtc;
  const balance = (
    <Amount
      value={
        czk === null
          ? formatWhole(total)
          : formatCzkValue(satsToCzk(total, czk))
      }
      unit={czk === null ? copy.sat : copy.czk}
      caption={
        rate.status === "failed" ? copy.wallet.rateUnavailable : undefined
      }
    />
  );

  return (
    <Page title={copy.sections.wallet} testID="wallet-screen">
      <Stack alignItems="center" paddingVertical="$xxl">
        {czkPerBtc === null ? (
          balance
        ) : (
          <Pressable
            testID="wallet-balance"
            tooltip={copy.wallet.switchUnit}
            alignSelf="center"
            onPress={() => setShowSats((current) => !current)}
          >
            {balance}
          </Pressable>
        )}
      </Stack>
      <Button
        testID="wallet-withdraw"
        icon="ArrowUpRight"
        minHeight="$controlLg"
        disabled={(balances?.spendable ?? 0) === 0}
        onPress={() => setWithdrawing(true)}
      >
        {copy.wallet.withdraw}
      </Button>
      <CashRequest shopName={shop.name} sats={total} />
      <WithdrawSheet
        open={withdrawing}
        onOpenChange={setWithdrawing}
        spendable={balances?.spendable ?? 0}
        czkPerBtc={czkPerBtc}
      />
    </Page>
  );
}

function CashRequest({
  shopName,
  sats,
}: {
  readonly shopName: string | null;
  readonly sats: number;
}) {
  const { supportChat } = useAppServices();
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">(
    "idle",
  );
  const request = async () => {
    setState("sending");
    try {
      await supportChat.send(cashRequestMessage(shopName, sats));
      setState("sent");
    } catch (error) {
      console.warn("[fazole] cash request not sent", error);
      setState("failed");
    }
  };
  return (
    <>
      <Button
        testID="wallet-request-cash"
        variant="secondary"
        icon="Banknote"
        minHeight="$controlLg"
        loading={state === "sending"}
        disabled={sats === 0}
        onPress={() => void request()}
      >
        {copy.wallet.requestCash}
      </Button>
      {state === "sent" ? (
        <Notice tone="accent" title={copy.wallet.cashRequested} />
      ) : state === "failed" ? (
        <Notice tone="danger" title={copy.wallet.cashRequestFailed} />
      ) : null}
    </>
  );
}
