import {
  Amount,
  Button,
  Card,
  EmptyState,
  ListRow,
  Pill,
  Section,
  Spinner,
  Text,
  type IconName,
} from "@linky-fit/ui";
import { useState } from "react";
import { copy } from "../copy";
import { satsToCzk, type WalletActivity } from "../domain";
import { formatCzkValue, formatDateTime, formatWhole } from "../format";
import {
  useCzkRate,
  useWalletActivity,
  useWalletBalance,
} from "../services/react";
import { Page } from "./Page";
import { methodIcons } from "./paymentLabels";
import { WithdrawSheet } from "./WithdrawSheet";

export function WalletScreen() {
  const balances = useWalletBalance();
  const rate = useCzkRate();
  const activity = useWalletActivity();
  const [withdrawing, setWithdrawing] = useState(false);
  const total = balances?.total ?? 0;
  const czkPerBtc = rate.status === "ready" ? rate.czkPerBtc : null;

  return (
    <Page title={copy.sections.wallet} testID="wallet-screen">
      <Card alignItems="center" gap="$md" paddingVertical="$xxl">
        <Text variant="label" color="$colorMuted">
          {copy.wallet.balance}
        </Text>
        <Amount
          value={formatWhole(total)}
          unit={copy.sat}
          caption={
            czkPerBtc !== null
              ? copy.approxCzk(formatCzkValue(satsToCzk(total, czkPerBtc)))
              : rate.status === "failed"
                ? copy.wallet.rateUnavailable
                : undefined
          }
        />
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
              <ActivityRow key={item.id} item={item} />
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
    case "withdrawal":
      return item.withdrawal.kind === "cashu_chat" ? "Send" : "ArrowUpRight";
  }
};

function ActivityRow({ item }: { readonly item: WalletActivity }) {
  const row = copy.wallet.row(formatDateTime(item.atSec), activityLabel(item));
  const status = item.kind === "withdrawal" ? item.withdrawal.status : "done";
  const sats = formatWhole(
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
          ? copy.wallet.out(sats)
          : copy.wallet.in(sats)
      }
      description={
        item.feeSats > 0
          ? copy.wallet.rowFee(row, formatWhole(item.feeSats))
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
