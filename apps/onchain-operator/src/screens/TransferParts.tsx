import {
  Button,
  Card,
  ListRow,
  Pill,
  Row,
  StatusDot,
  Text,
} from "@linky-fit/ui";
import type { Tone } from "@linky-fit/ui";
import type { OperatorTransferStatus } from "@linky-fit/onchain-transfer";
import { copy } from "../copy/en";
import { transferTerms, type OperatorTransfer } from "../domain/transfer";
import { formatDateTime, formatSats } from "../format";
import { statusKey, transferTitle } from "./labels";
import { navigateTo } from "../platform/hashRoute";
import { transferRoute } from "../routing";
import { usePeerProfile } from "../services/react";

const statusTones: Record<OperatorTransferStatus | "requested", Tone> = {
  requested: "warning",
  accepted: "info",
  fundsSeen: "info",
  fundsReceived: "warning",
  completed: "accent",
  denied: "neutral",
  cancelled: "neutral",
  refunded: "neutral",
};

export function StatusPill({
  transfer,
}: {
  readonly transfer: OperatorTransfer;
}) {
  const key = statusKey(transfer);
  return <Pill size="sm" label={copy.status[key]} tone={statusTones[key]} />;
}

/** One transfer in a list; opens its detail. */
export function TransferRow({
  transfer,
}: {
  readonly transfer: OperatorTransfer;
}) {
  const key = statusKey(transfer);
  const { name } = usePeerProfile(transfer.user);
  return (
    <ListRow
      testID={`transfer-row-${transfer.id}`}
      leading={
        <StatusDot
          tone={statusTones[key]}
          accessibilityLabel={copy.status[key]}
        />
      }
      title={transferTitle(transfer)}
      description={`${copy.status[key]} · ${name}`}
      meta={formatDateTime(transfer.createdAtSec)}
      onPress={() => navigateTo(transferRoute(transfer.id))}
    />
  );
}

/** A transfer inline in the chat with its user. */
export function TransferCard({
  transfer,
}: {
  readonly transfer: OperatorTransfer;
}) {
  return (
    <Card outlined gap="$sm" testID={`transfer-card-${transfer.id}`}>
      <Row justifyContent="space-between">
        <Text bold>{transferTitle(transfer)}</Text>
        <StatusPill transfer={transfer} />
      </Row>
      <Text variant="caption" color="$colorMuted">
        {`${copy.transfer.receive}: ${formatSats(transferTerms(transfer).amount)} · ${formatDateTime(transfer.createdAtSec)}`}
      </Text>
      <Button
        size="sm"
        variant="secondary"
        alignSelf="flex-start"
        onPress={() => navigateTo(transferRoute(transfer.id))}
      >
        {copy.transfer.open}
      </Button>
    </Card>
  );
}
