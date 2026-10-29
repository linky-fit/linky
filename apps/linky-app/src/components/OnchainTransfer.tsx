import {
  Avatar,
  ListRow,
  opacity,
  Pill,
  Row,
  Stack,
  Text,
} from "@linky-fit/ui";
import React from "react";
import { useDisplayAmounts, useTranslation } from "../app/hooks/shell";
import {
  ONCHAIN_TRANSFER_HISTORY_TITLE_KEYS,
  ONCHAIN_TRANSFER_PHASE_LABEL_KEYS,
  ONCHAIN_TRANSFER_PHASE_TONES,
  onchainTransferHistoryAmount,
} from "../app/lib/onchainTransferLabels";
import {
  isFinishedOnchainTransferPhase,
  type OnchainTransferView,
} from "../app/lib/onchainTransfers";
import { navigateTo } from "../hooks/useRouting";
import { formatTimeAgo } from "../utils/formatting";

export function OnchainTransferPhasePill({
  transfer,
}: {
  transfer: Pick<OnchainTransferView, "phase">;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <Pill
      size="sm"
      label={t(ONCHAIN_TRANSFER_PHASE_LABEL_KEYS[transfer.phase])}
      tone={ONCHAIN_TRANSFER_PHASE_TONES[transfer.phase]}
      testID="onchain-transfer-phase"
    />
  );
}

/** A transfer in the payment history; only a completed one reads and looks like money that moved. */
export function OnchainTransferHistoryRow({
  transfer,
}: {
  transfer: OnchainTransferView;
}): React.ReactElement {
  const { lang, t } = useTranslation();
  const { formatDisplayedAmountText } = useDisplayAmounts();
  const { direction, phase } = transfer;
  const title = t(ONCHAIN_TRANSFER_HISTORY_TITLE_KEYS[direction]);
  const amount = onchainTransferHistoryAmount(transfer);
  const finished = isFinishedOnchainTransferPhase(phase);
  const noMoneyMoved =
    amount === null && (phase === "denied" || phase === "cancelled");
  return (
    <Stack
      testID="onchain-transfer-row"
      opacity={finished && phase !== "completed" ? opacity.disabled : 1}
    >
      <ListRow
        leading={<Avatar name={title} icon="Bitcoin" />}
        title={title}
        description={
          <Row gap="$sm" flexWrap="wrap" alignItems="center">
            <Text variant="caption" color="$colorMuted">
              {formatTimeAgo(transfer.createdAtSec, lang)}
            </Text>
            {phase === "completed" ? null : (
              <OnchainTransferPhasePill transfer={transfer} />
            )}
            {noMoneyMoved ? (
              <Text variant="caption" color="$colorMuted">
                {t("onchainTransferNoMoneyMoved")}
              </Text>
            ) : null}
          </Row>
        }
        trailing={
          amount === null ? null : (
            <Text
              variant="label"
              bold={phase === "completed"}
              color={
                phase !== "completed"
                  ? "$colorMuted"
                  : direction === "send"
                    ? "$dangerText"
                    : "$accentText"
              }
            >
              {formatDisplayedAmountText(amount)}
            </Text>
          )
        }
        chevron={false}
        onPress={() =>
          navigateTo({ route: "onchainTransfer", id: transfer.id })
        }
      />
    </Stack>
  );
}
