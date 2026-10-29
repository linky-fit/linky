import {
  Avatar,
  ListRow,
  opacity,
  Pill,
  Row,
  Section,
  Stack,
  Text,
} from "@linky-fit/ui";
import type { OnchainTransferDirection } from "@linky-fit/onchain-transfer";
import React from "react";
import { useDisplayAmounts, useTranslation } from "../app/hooks/shell";
import { useExactAmountText } from "../app/hooks/useExactAmountText";
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

interface OnchainTransferAmountsProps {
  /** Heads the amounts when they are not what happened, e.g. "Original terms". */
  title?: string | undefined;
  direction: OnchainTransferDirection;
  /** The transfer amount: what the user gets. */
  amount: number;
  fee: number;
  /** The amount plus the fee: what the user pays or sends. */
  total: number;
  /** The service fee as a percentage, e.g. "1 %"; null when not known. */
  feePercent: string | null;
  /** Leaves out the fee, e.g. once it was explained and the deposit set the terms. */
  showFee?: boolean | undefined;
  /** Leaves out what the user sends, e.g. once the deposit itself is listed. */
  showTotal?: boolean | undefined;
}

/** What the user gets, the service fee and what they pay, as on a receipt; in sats beside the display currency only for a receive, whose total the user sends on-chain. */
export function OnchainTransferAmounts({
  title,
  direction,
  amount,
  fee,
  total,
  feePercent,
  showFee = true,
  showTotal = true,
}: OnchainTransferAmountsProps): React.ReactElement {
  const { t } = useTranslation();
  const { exact } = useExactAmountText();
  const { formatDisplayedAmountText } = useDisplayAmounts();
  const value = direction === "receive" ? exact : formatDisplayedAmountText;
  return (
    <Section title={title}>
      <ListRow title={t("onchainTransferYouGet")} value={value(amount)} />
      {showFee ? (
        <ListRow
          title={
            feePercent === null
              ? t("onchainTransferServiceFee")
              : `${t("onchainTransferServiceFee")} (${feePercent})`
          }
          value={value(fee)}
        />
      ) : null}
      {showTotal ? (
        <ListRow
          title={t(
            direction === "send"
              ? "onchainSendYouPay"
              : "onchainReceiveYouSend",
          )}
          value={value(total)}
          testID="onchain-transfer-total"
        />
      ) : null}
    </Section>
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
        onPress={() =>
          navigateTo({ route: "onchainTransfer", id: transfer.id })
        }
      />
    </Stack>
  );
}
