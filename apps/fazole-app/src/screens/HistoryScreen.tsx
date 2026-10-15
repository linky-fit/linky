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
import type { TransactionId } from "@linky-fit/domain";
import type { Pubkey } from "@linky-fit/linkstr";
import { useState } from "react";
import { copy } from "../copy";
import {
  canHideFromHistory,
  CzkAmount,
  directTransferCzk,
  groupByDay,
  relativeDay,
  type DirectTransfer,
  type HistoryEntry,
  type Payment,
} from "../domain";
import {
  formatCzk,
  formatCzkValue,
  formatDateTime,
  formatDay,
  formatTime,
  formatWhole,
  shortNpub,
} from "../format";
import { navigateTo } from "../platform/hashRoute";
import { paymentRoute } from "../routing";
import {
  useAppServices,
  useHistory,
  usePayerName,
  usePayerProfile,
} from "../services/react";
import { nowSeconds } from "../utils/time";
import { ConfirmDialog } from "./ConfirmDialog";
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
  const { history } = useAppServices();
  const entries = useHistory();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hidingId, setHidingId] = useState<TransactionId | null>(null);
  const [nowSec] = useState(nowSeconds);
  const selected = entries.find((entry) => entry.id === selectedId);

  return (
    <Page title={copy.sections.history} testID="history-screen">
      {entries.length === 0 ? (
        <EmptyState
          icon="History"
          title={copy.history.emptyTitle}
          description={copy.history.emptyDescription}
        />
      ) : (
        groupByDay(entries).map((day) => (
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
              {day.entries.map((entry) =>
                entry.kind === "payment" ? (
                  <PaymentRow
                    key={entry.id}
                    payment={entry.payment}
                    onPress={() => setSelectedId(entry.id)}
                  />
                ) : (
                  <DirectTransferRow
                    key={entry.id}
                    transfer={entry.transfer}
                    onPress={() => setSelectedId(entry.id)}
                  />
                ),
              )}
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
        {selected ? (
          <EntryDetail
            entry={selected}
            onHide={() => {
              setSelectedId(null);
              setHidingId(selected.id);
            }}
          />
        ) : null}
      </Sheet>
      <ConfirmDialog
        open={hidingId !== null}
        onClose={() => setHidingId(null)}
        title={copy.history.hide}
        description={copy.history.hideConfirmDescription}
        confirm={copy.history.hide}
        destructive
        onConfirm={() => {
          if (hidingId !== null) void history.hide(hidingId);
          setHidingId(null);
        }}
      />
    </Page>
  );
}

function PaymentRow({
  payment,
  onPress,
}: {
  readonly payment: Payment;
  readonly onPress: () => void;
}) {
  return (
    <ListRow
      testID={`payment-row-${payment.id}`}
      icon={payment.method === null ? "QrCode" : methodIcons[payment.method]}
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
      onPress={onPress}
    />
  );
}

/** A direct transfer: its CZK value at its rate, or its sats without one. */
function DirectTransferRow({
  transfer,
  onPress,
}: {
  readonly transfer: DirectTransfer;
  readonly onPress: () => void;
}) {
  const payer = usePayerName(transfer.payerPubkey);
  const czk = directTransferCzk(transfer);
  const sats = copy.satAmount(formatWhole(transfer.sats));
  return (
    <ListRow
      testID={`direct-row-${transfer.id}`}
      icon="HandCoins"
      title={czk === null ? sats : formatCzk(czk)}
      meta={czk === null ? undefined : sats}
      description={copy.history.row(
        formatTime(transfer.receivedAtSec),
        copy.history.direct,
        payer,
      )}
      chevron={false}
      onPress={onPress}
    />
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

function EntryDetail({
  entry,
  onHide,
}: {
  readonly entry: HistoryEntry;
  readonly onHide: () => void;
}) {
  return (
    <Stack gap="$lg">
      {entry.kind === "payment" ? (
        <PaymentDetail payment={entry.payment} />
      ) : (
        <DirectTransferDetail transfer={entry.transfer} />
      )}
      {canHideFromHistory(entry) ? (
        <Button
          testID="history-hide"
          variant="ghost"
          icon="EyeOff"
          onPress={onHide}
        >
          {copy.history.hide}
        </Button>
      ) : null}
    </Stack>
  );
}

const directTransferDetails = (transfer: DirectTransfer): Detail[] => {
  const czk = directTransferCzk(transfer);
  return [
    ...(transfer.note === null
      ? []
      : [{ label: copy.history.note, value: transfer.note }]),
    {
      label: copy.history.amount,
      value: copy.history.directAmount(
        formatWhole(transfer.sats),
        czk === null ? null : formatCzkValue(czk),
      ),
    },
    {
      label: copy.history.receivedAt,
      value: formatDateTime(transfer.receivedAtSec),
    },
  ];
};

function DirectTransferDetail({
  transfer,
}: {
  readonly transfer: DirectTransfer;
}) {
  const czk = directTransferCzk(transfer);
  return (
    <Stack gap="$lg" paddingTop="$sm" testID="direct-transfer-detail">
      <Stack alignItems="center" gap="$sm">
        <Amount
          value={formatWhole(transfer.sats)}
          unit={copy.sat}
          size="md"
          caption={
            czk === null ? undefined : copy.approxCzk(formatCzkValue(czk))
          }
        />
        <Row justifyContent="center">
          <Pill tone="accent" label={copy.history.direct} />
        </Row>
      </Stack>
      <Payer pubkey={transfer.payerPubkey} />
      <DetailRows details={directTransferDetails(transfer)} />
    </Stack>
  );
}

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

/** Who sent the sats, by their Nostr name and photo once a relay answers. */
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
