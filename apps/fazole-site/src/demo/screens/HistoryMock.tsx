import {
  Amount,
  Avatar,
  Button,
  Card,
  ListRow,
  Pill,
  Row,
  Stack,
  Text,
} from "@linky-fit/ui";
import { useState } from "react";
import type { ReactNode } from "react";
import { copy } from "../../copy";
import { DemoScreen, DemoSheet, DetailRows, Page } from "../chrome";
import type { Detail } from "../chrome";
import {
  czk,
  dayTitle,
  groupByDay,
  methodLabel,
  paymentIcon,
  statusTones,
} from "../labels";
import {
  formatCrowns,
  formatDateTime,
  formatTime,
  formatWhole,
} from "../money";
import { useDemo } from "../store";
import type { DemoPayment } from "../store";

const t = copy.demo;

const rowDescription = (payment: DemoPayment): string => {
  const row = t.history.row(
    formatTime(payment.createdAt),
    methodLabel(payment),
  );
  return payment.tipHalere === null
    ? row
    : `${row} · ${t.history.tipped(czk(payment.tipHalere))}`;
};

const paymentDetails = (payment: DemoPayment): Detail[] => [
  ...(payment.tipHalere === null
    ? []
    : [
        {
          label: t.history.amount,
          value: czk(payment.amountHalere - payment.tipHalere),
        },
        { label: t.history.tip, value: czk(payment.tipHalere) },
        { label: t.history.total, value: czk(payment.amountHalere) },
      ]),
  ...(payment.method === null
    ? []
    : [{ label: t.history.method, value: t.methods[payment.method] }]),
  ...(payment.sats === null
    ? []
    : [
        {
          label: t.payment.sats,
          value: t.satAmount(formatWhole(payment.sats)),
        },
      ]),
  { label: t.payment.vs, value: payment.vs },
  { label: t.history.created, value: formatDateTime(payment.createdAt) },
  ...(payment.paidAt === null
    ? []
    : [{ label: t.history.paidAt, value: formatDateTime(payment.paidAt) }]),
];

function PaymentDetail({
  payment,
  onShowQr,
}: {
  payment: DemoPayment;
  onShowQr: () => void;
}) {
  return (
    <Stack gap="$lg" paddingTop="$sm">
      <Stack alignItems="center" gap="$sm">
        <Amount
          value={formatCrowns(payment.amountHalere)}
          unit={t.czk}
          size="md"
        />
        <Row justifyContent="center">
          <Pill
            tone={statusTones[payment.status]}
            label={t.statuses[payment.status]}
          />
        </Row>
      </Stack>
      {payment.payer ? (
        <Row justifyContent="center" gap="$sm">
          <Avatar name={payment.payer.name} size="sm" raised />
          <Text color="$colorSubtle">
            {t.payment.paidFrom(payment.payer.name)}
          </Text>
        </Row>
      ) : null}
      <DetailRows details={paymentDetails(payment)} />
      {payment.status === "pending" ? (
        <Button icon="QrCode" onPress={onShowQr}>
          {t.history.showQr}
        </Button>
      ) : null}
    </Stack>
  );
}

/** The history, like the app's: payments by day with the day's paid total, and each payment's details. */
export function HistoryMock({
  tabBar,
  onOpenPayment,
}: {
  tabBar: ReactNode;
  onOpenPayment: (id: string) => void;
}) {
  const { payments } = useDemo();
  const [selectedId, setSelectedId] = useState<string>();
  const [now] = useState(() => new Date());
  const selected = payments.find(({ id }) => id === selectedId);

  return (
    <DemoScreen
      tabBar={tabBar}
      overlay={
        <DemoSheet
          open={selected !== undefined}
          onClose={() => setSelectedId(undefined)}
          title={t.history.detail}
        >
          {selected ? (
            <PaymentDetail
              payment={selected}
              onShowQr={() => onOpenPayment(selected.id)}
            />
          ) : null}
        </DemoSheet>
      }
    >
      <Page title={t.sections.history}>
        {groupByDay(payments).map((day) => (
          <Stack key={day.startMs} gap="$xs">
            <Row justifyContent="space-between" paddingVertical="$sm">
              <Text eyebrow role="heading">
                {dayTitle(day.startMs, now)}
              </Text>
              <Text
                variant="caption"
                color="$colorMuted"
                fontVariant={["tabular-nums"]}
              >
                {t.history.dayTotal(czk(day.paidTotal))}
              </Text>
            </Row>
            <Card paddingVertical="$sm" gap="$none">
              {day.payments.map((payment) => (
                <ListRow
                  key={payment.id}
                  icon={paymentIcon(payment)}
                  title={czk(payment.amountHalere)}
                  description={rowDescription(payment)}
                  trailing={
                    <Pill
                      size="sm"
                      tone={statusTones[payment.status]}
                      label={t.statuses[payment.status]}
                    />
                  }
                  chevron={false}
                  onPress={() => setSelectedId(payment.id)}
                />
              ))}
            </Card>
          </Stack>
        ))}
      </Page>
    </DemoScreen>
  );
}
