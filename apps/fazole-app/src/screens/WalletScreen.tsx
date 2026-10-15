import {
  Amount,
  Button,
  Card,
  EmptyState,
  ListRow,
  Notice,
  Pill,
  Pressable,
  Section,
  Spinner,
  Text,
  type IconName,
} from "@linky-fit/ui";
import { useState } from "react";
import { copy } from "../copy";
import {
  cashRequestMessage,
  satsToCzk,
  type ShopProfile,
  type WalletActivity,
} from "../domain";
import {
  formatCzk,
  formatCzkValue,
  formatDateTime,
  formatWhole,
} from "../format";
import {
  useAppServices,
  useCzkRate,
  useWalletActivity,
  useWalletBalance,
} from "../services/react";
import { Page } from "./Page";
import { methodIcons } from "./paymentLabels";
import { WithdrawSheet } from "./WithdrawSheet";

export function WalletScreen({ shop }: { readonly shop: ShopProfile }) {
  const balances = useWalletBalance();
  const rate = useCzkRate();
  const activity = useWalletActivity();
  const [withdrawing, setWithdrawing] = useState(false);
  const total = balances?.total ?? 0;
  const czkPerBtc = rate.status === "ready" ? rate.czkPerBtc : null;
  // Starts in CZK on every visit, so a merchant never lands on sats unexpectedly.
  const [showSats, setShowSats] = useState(false);
  const czk = showSats ? null : czkPerBtc;
  const formatSats = (sats: number) =>
    czk === null
      ? copy.satAmount(formatWhole(sats))
      : formatCzk(satsToCzk(sats, czk));
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
      <Card alignItems="center" gap="$md" paddingVertical="$xxl">
        <Text variant="label" color="$colorMuted">
          {copy.wallet.balance}
        </Text>
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
      </Card>
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
      <Section title={copy.wallet.activity}>
        {activity.length === 0 ? (
          <EmptyState
            icon="History"
            title={copy.wallet.activityEmptyTitle}
            description={copy.wallet.activityEmptyDescription}
          />
        ) : (
          <Card paddingVertical="$sm" gap="$none">
            {activity.map((item) => (
              <ActivityRow key={item.id} item={item} formatSats={formatSats} />
            ))}
          </Card>
        )}
      </Section>
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
  readonly shopName: string;
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

const activityLabel = (item: WalletActivity): string => {
  switch (item.kind) {
    case "payment":
      return item.payment.method === "cashu"
        ? copy.methods.cashu
        : copy.methods.lightning;
    case "receipt":
      return item.receipt.paymentId === null
        ? copy.wallet.receiptUnassigned
        : copy.wallet.receiptPaidAgain(copy.methods[item.receipt.method]);
    case "direct":
      return copy.history.direct;
    case "withdrawal":
      return item.withdrawal.kind === "cashu_chat"
        ? copy.wallet.withdrawalLinky
        : copy.wallet.withdrawalLightning;
  }
};

const activityIcon = (item: WalletActivity): IconName => {
  switch (item.kind) {
    case "payment":
      return item.payment.method === "cashu"
        ? methodIcons.cashu
        : methodIcons.lightning;
    case "receipt":
      return methodIcons[item.receipt.method];
    case "direct":
      return "HandCoins";
    case "withdrawal":
      return item.withdrawal.kind === "cashu_chat" ? "Send" : "ArrowUpRight";
  }
};

function ActivityRow({
  item,
  formatSats,
}: {
  readonly item: WalletActivity;
  readonly formatSats: (sats: number) => string;
}) {
  const row = copy.wallet.row(formatDateTime(item.atSec), activityLabel(item));
  const status = item.kind === "withdrawal" ? item.withdrawal.status : "done";
  const amount = formatSats(
    item.kind === "withdrawal" && status === "failed"
      ? item.withdrawal.amountSats
      : item.sats,
  );
  return (
    <ListRow
      testID={`activity-${item.id}`}
      icon={activityIcon(item)}
      title={
        item.kind === "withdrawal"
          ? copy.wallet.out(amount)
          : copy.wallet.in(amount)
      }
      description={
        item.feeSats > 0
          ? copy.wallet.rowFee(row, formatSats(item.feeSats))
          : row
      }
      trailing={
        status === "pending" ? (
          <Pill
            size="sm"
            tone="warning"
            label={copy.wallet.pending}
            leading={<Spinner color="$warningText" />}
          />
        ) : status === "failed" ? (
          <Pill size="sm" tone="danger" label={copy.wallet.failed} />
        ) : undefined
      }
      chevron={false}
    />
  );
}
