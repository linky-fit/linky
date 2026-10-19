import { Amount, Button, Pressable, Stack } from "@linky-fit/ui";
import { useState } from "react";
import { copy } from "../copy";
import { CzkAmount, satsToCzk, type Pledge, type ShopProfile } from "../domain";
import { formatCzkWholeValue, formatWhole } from "../format";
import {
  useCzkRate,
  usePledgerName,
  usePledgeStatus,
  useWalletBalance,
} from "../services/react";
import { CashSheet } from "./CashSheet";
import { Page } from "./Page";
import { WithdrawSheet } from "./WithdrawSheet";

/** Whole crowns with the pledge still owed taken off, e.g. "-100" while nothing came in yet. */
const netCzkValue = (czk: CzkAmount, owedCzk: CzkAmount): string => {
  const whole = Math.round((czk - owedCzk) / 100);
  return whole < 0 ? `-${formatWhole(-whole)}` : formatWhole(whole);
};

export function WalletScreen({ shop }: { readonly shop: ShopProfile }) {
  const balances = useWalletBalance();
  const rate = useCzkRate();
  const pledge = usePledgeStatus();
  const [withdrawing, setWithdrawing] = useState(false);
  const [cash, setCash] = useState(false);
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
          : netCzkValue(
              satsToCzk(total, czk),
              pledge?.remainingCzk ?? CzkAmount.make(0),
            )
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
      {pledge ? (
        <PledgeButton
          pledge={pledge.pledge}
          remainingCzk={pledge.remainingCzk}
          onPress={() => setCash(true)}
        />
      ) : (
        <Button
          testID="wallet-cash"
          variant="secondary"
          icon="Banknote"
          minHeight="$controlLg"
          onPress={() => setCash(true)}
        >
          {copy.wallet.cash}
        </Button>
      )}
      <WithdrawSheet
        open={withdrawing}
        onOpenChange={setWithdrawing}
        spendable={balances?.spendable ?? 0}
        czkPerBtc={czkPerBtc}
      />
      <CashSheet
        open={cash}
        onOpenChange={setCash}
        shopName={shop.name}
        sats={total}
        czkPerBtc={czkPerBtc}
        current={pledge}
      />
    </Page>
  );
}

/** The pledge button names who the shop owes and how much. */
function PledgeButton({
  pledge,
  remainingCzk,
  onPress,
}: {
  readonly pledge: Pledge;
  readonly remainingCzk: CzkAmount;
  readonly onPress: () => void;
}) {
  const name = usePledgerName(pledge);
  return (
    <Button
      testID="wallet-cash"
      variant="secondary"
      icon="HandCoins"
      minHeight="$controlLg"
      onPress={onPress}
    >
      {copy.wallet.pledgeButton(name, formatCzkWholeValue(remainingCzk))}
    </Button>
  );
}
