import type { OnchainTransferDirection } from "@linky-fit/onchain-transfer";
import {
  Amount,
  Card,
  DataTable,
  ListRow,
  LoadingState,
  Row,
  Section,
  SegmentedControl,
  Stack,
  StatusDot,
  Text,
  type Tone,
} from "@linky-fit/ui";
import { useState } from "react";
import { copy } from "../copy/en";
import {
  completionRate,
  inPeriod,
  monthlyAnalytics,
  periods,
  transferAnalytics,
  type FlowTotals,
  type MonthAnalytics,
  type Period,
  type TransferOutcome,
} from "../domain/analytics";
import type { OperatorTransfer } from "../domain/transfer";
import { formatMonth, formatNumber, formatSats } from "../format";
import { useTransfers } from "../services/react";
import { nowSeconds } from "../utils/time";
import { Page } from "./Page";

const directions: readonly OnchainTransferDirection[] = ["receive", "send"];
const outcomes: readonly TransferOutcome[] = [
  "completed",
  "open",
  "refunded",
  "cancelled",
  "denied",
];
const outcomeTones: Record<TransferOutcome, Tone> = {
  completed: "accent",
  open: "info",
  refunded: "neutral",
  cancelled: "neutral",
  denied: "neutral",
};

const periodOptions = periods.map((value) => ({
  value,
  label: copy.stats.periods[value],
}));

/** What flowed through the transfers in a chosen period; months follow the browser's time zone. */
export function StatsScreen() {
  const transfers = useTransfers();
  const [period, setPeriod] = useState<Period>("allTime");
  if (transfers === null) return <LoadingState label={copy.loading} />;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const stats = transferAnalytics(
    transfers,
    inPeriod(period, nowSeconds(), timeZone),
  );
  const rate = completionRate(stats.outcomes);
  return (
    <Page title={copy.sections.stats} testID="stats-screen">
      <SegmentedControl
        accessibilityLabel={copy.stats.period}
        value={period}
        options={periodOptions}
        onValueChange={setPeriod}
      />
      <Section title={copy.stats.completed}>
        <Stack gap="$md">
          <Row gap="$md" alignItems="stretch" flexWrap="wrap">
            <AmountTile
              testID="stats-volume"
              sats={stats.completed.amount}
              caption={copy.stats.volume}
            />
            <AmountTile
              testID="stats-fees"
              sats={stats.completed.fees}
              caption={copy.stats.fees}
            />
          </Row>
          <Stack gap="$none">
            <ListRow
              testID="stats-sent"
              title={copy.stats.sent}
              description={copy.stats.sentHint}
              value={formatSats(stats.completed.sent)}
            />
            <ListRow
              testID="stats-count"
              title={copy.stats.transferCount}
              value={stats.completed.count}
            />
          </Stack>
        </Stack>
      </Section>
      <Section title={copy.stats.byDirection}>
        {directions.map((direction) => (
          <DirectionRow
            key={direction}
            direction={direction}
            totals={stats.byDirection[direction]}
          />
        ))}
      </Section>
      <Section title={copy.stats.outcomes}>
        {outcomes.map((outcome) => (
          <ListRow
            key={outcome}
            testID={`stats-outcome-${outcome}`}
            leading={
              <StatusDot
                tone={outcomeTones[outcome]}
                accessibilityLabel={copy.stats.outcome[outcome]}
              />
            }
            title={copy.stats.outcome[outcome]}
            value={stats.outcomes[outcome]}
          />
        ))}
        {rate === null ? null : (
          <Text variant="caption" color="$colorMuted">
            {copy.stats.completionRate(Math.round(rate * 100))}
          </Text>
        )}
      </Section>
      {period === "allTime" ? (
        <MonthTable transfers={transfers} timeZone={timeZone} />
      ) : null}
      <Text variant="caption" color="$colorMuted">
        {copy.stats.footnote}
      </Text>
    </Page>
  );
}

function AmountTile({
  sats,
  caption,
  testID,
}: {
  readonly sats: number;
  readonly caption: string;
  readonly testID: string;
}) {
  return (
    // The basis wraps the two tiles onto separate lines at phone width.
    <Card flexGrow={1} flexBasis={200} justifyContent="center" testID={testID}>
      <Amount
        size="md"
        value={formatNumber(sats)}
        unit="sat"
        caption={caption}
      />
    </Card>
  );
}

function DirectionRow({
  direction,
  totals,
}: {
  readonly direction: OnchainTransferDirection;
  readonly totals: FlowTotals;
}) {
  return (
    <ListRow
      testID={`stats-direction-${direction}`}
      title={copy.direction[direction]}
      description={copy.stats.directionSummary(
        copy.stats.directionHint[direction],
        totals.count,
        formatSats(totals.fees),
      )}
      value={formatSats(totals.amount)}
    />
  );
}

function MonthTable({
  transfers,
  timeZone,
}: {
  readonly transfers: readonly OperatorTransfer[];
  readonly timeZone: string;
}) {
  const months = monthlyAnalytics(transfers, timeZone);
  if (months.length === 0) return null;
  return (
    <Section title={copy.stats.byMonth}>
      <DataTable
        fill
        accessibilityLabel={copy.stats.byMonth}
        columns={[
          { key: "month", label: copy.stats.month, span: 0.8 },
          ...directions.map((direction) => ({
            key: direction,
            label: copy.direction[direction],
          })),
        ]}
        rows={months.map((month: MonthAnalytics) => ({
          key: month.month,
          cells: [
            formatMonth(month.month),
            ...directions.map((direction) => (
              <MonthCell
                key={direction}
                totals={month.byDirection[direction]}
              />
            )),
          ],
        }))}
      />
    </Section>
  );
}

function MonthCell({ totals }: { readonly totals: FlowTotals }) {
  return (
    <Stack gap="$xxs">
      <Text variant="caption">{formatSats(totals.amount)}</Text>
      <Text variant="caption" color="$colorMuted">
        {copy.stats.monthFee(formatSats(totals.fees))}
      </Text>
    </Stack>
  );
}
