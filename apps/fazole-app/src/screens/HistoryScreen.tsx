import {
  Amount,
  Avatar,
  Button,
  Card,
  EmptyState,
  ListRow,
  Pill,
  Row,
  Sheet,
  Stack,
  Text,
} from "@linky-fit/ui";
import type { Pubkey } from "@linky-fit/linkstr";
import { useState } from "react";
import { copy } from "../copy";
import {
  CzkAmount,
  formatCzk,
  groupByDay,
  relativeDay,
  type Payment,
} from "../domain";
import {
  formatCzkValue,
  formatDateTime,
  formatDay,
  formatTime,
  formatWhole,
  shortNpub,
} from "../format";
import { navigateTo } from "../platform/hashRoute";
import { paymentRoute } from "../routing";
import { usePayerProfile, usePayments } from "../services/react";
import { nowSeconds } from "../utils/time";
import { DetailRows, type Detail } from "./DetailRows";
import { Page } from "./Page";
import { methodIcons, methodLabel, statusTones } from "./paymentLabels";

const dayTitle = (startSec: number, nowSec: number) => {
  const relative = relativeDay(startSec, nowSec);
  return relative === "today"
    ? copy.history.today
    : relative === "yesterday"
      ? copy.history.yesterday
      : formatDay(startSec);
};

export function HistoryScreen() {
  const payments = usePayments();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nowSec] = useState(nowSeconds);
  const selected = payments.find((payment) => payment.id === selectedId);

  return (
    <Page title={copy.sections.history} testID="history-screen">
      {payments.length === 0 ? (
        <EmptyState
          icon="History"
          title={copy.history.emptyTitle}
          description={copy.history.emptyDescription}
        />
      ) : (
        groupByDay(payments).map((day) => (
          <Stack key={day.startSec} gap="$xs">
            <Row justifyContent="space-between" paddingVertical="$sm">
              <Text eyebrow role="heading">
                {dayTitle(day.startSec, nowSec)}
              </Text>
              <Text
                variant="caption"
                color="$colorMuted"
                fontVariant={["tabular-nums"]}
              >
                {copy.history.dayTotal(formatCzk(day.paidTotal))}
              </Text>
            </Row>
            <Card paddingVertical="$sm" gap="$none">
              {day.payments.map((payment) => (
                <ListRow
                  key={payment.id}
                  testID={`payment-row-${payment.id}`}
                  icon={
                    payment.method === null
                      ? "QrCode"
                      : methodIcons[payment.method]
                  }
                  title={formatCzk(payment.amountCzk)}
                  description={rowDescription(payment)}
                  trailing={
                    <Pill
                      size="sm"
                      tone={statusTones[payment.status]}
                      label={copy.statuses[payment.status]}
                    />
                  }
                  chevron={false}
                  onPress={() => setSelectedId(payment.id)}
                />
              ))}
            </Card>
          </Stack>
        ))
      )}
      <Sheet
        open={selected !== undefined}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
        title={copy.history.detail}
      >
        {selected ? <PaymentDetail payment={selected} /> : null}
      </Sheet>
    </Page>
  );
}

const rowDescription = (payment: Payment): string => {
  const row = copy.history.row(
    formatTime(payment.createdAtSec),
    methodLabel(payment),
  );
  return payment.tipCzk === null
    ? row
    : `${row} · ${copy.history.tipped(formatCzk(payment.tipCzk))}`;
};

const amountDetails = (payment: Payment): Detail[] =>
  payment.tipCzk === null
    ? []
    : [
        {
          label: copy.history.amount,
          value: formatCzk(CzkAmount.make(payment.amountCzk - payment.tipCzk)),
        },
        { label: copy.history.tip, value: formatCzk(payment.tipCzk) },
        { label: copy.history.total, value: formatCzk(payment.amountCzk) },
      ];

const paymentDetails = (payment: Payment): Detail[] => [
  ...amountDetails(payment),
  ...(payment.method === null
    ? []
    : [{ label: copy.history.method, value: copy.methods[payment.method] }]),
  ...(payment.bitcoin !== null && payment.method !== "bank"
    ? [
        {
          label: copy.payment.sats,
          value: copy.satAmount(formatWhole(payment.bitcoin.sats)),
        },
      ]
    : []),
  { label: copy.payment.vs, value: payment.vs },
  { label: copy.history.created, value: formatDateTime(payment.createdAtSec) },
  ...(payment.paidAtSec === null
    ? []
    : [
        {
          label: copy.history.paidAt,
          value: formatDateTime(payment.paidAtSec),
        },
      ]),
];

function PaymentDetail({ payment }: { readonly payment: Payment }) {
  return (
    <Stack gap="$lg" paddingTop="$sm" testID="payment-detail">
      <Stack alignItems="center" gap="$sm">
        <Amount
          value={formatCzkValue(payment.amountCzk)}
          unit={copy.czk}
          size="md"
        />
        <Row justifyContent="center">
          <Pill
            tone={statusTones[payment.status]}
            label={copy.statuses[payment.status]}
          />
        </Row>
      </Stack>
      {payment.payerPubkey === null ? null : (
        <Payer pubkey={payment.payerPubkey} />
      )}
      <DetailRows details={paymentDetails(payment)} />
      {payment.status === "pending" ? (
        <Button
          testID="history-show-qr"
          icon="QrCode"
          onPress={() => navigateTo(paymentRoute(payment.id))}
        >
          {copy.history.showQr}
        </Button>
      ) : null}
    </Stack>
  );
}

/** Who paid with a Cashu token, by their Nostr name and photo once a relay answers. */
function Payer({ pubkey }: { readonly pubkey: Pubkey }) {
  const profile = usePayerProfile(pubkey);
  const name = profile?.name ?? shortNpub(pubkey);
  return (
    <Row justifyContent="center" gap="$sm" testID="payment-payer">
      <Avatar
        name={name}
        uri={profile?.picture ?? undefined}
        size="sm"
        raised
      />
      <Text color="$colorSubtle">{copy.payment.paidFrom(name)}</Text>
    </Row>
  );
}
