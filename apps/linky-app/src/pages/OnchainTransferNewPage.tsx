import {
  Form,
  ListRow,
  LoadingState,
  Notice,
  Section,
  Stack,
  SubmitButton,
  Switch,
  Text,
  TextField,
} from "@linky-fit/ui";
import {
  amountWithServiceFee,
  isClientVersionSupported,
  serviceFee,
  type OnchainConfig,
  type OnchainTransferDirection,
} from "@linky-fit/onchain-transfer";
import React from "react";
import { useDisplayAmounts, useTranslation } from "../app/hooks/shell";
import {
  useOnchainConfig,
  useOnchainTransferCommands,
  useOnchainTransfersShown,
} from "../app/hooks/useOnchainTransfers";
import { useWalletBalance } from "../app/hooks/wallet/useWalletInventory";
import { formatServiceFeePercent } from "../app/lib/onchainTransferLabels";
import {
  newOnchainTransferProblem,
  type NewOnchainTransferDraft,
} from "../app/lib/onchainTransfers";
import { OnchainTransferAmounts } from "../components/OnchainTransfer";
import { useExactAmountText } from "../app/hooks/useExactAmountText";
import { applyPwaUpdate } from "../utils/pwaUpdate";

/** A scanned payout address and amount for an on-chain send. */
export interface OnchainSendPrefill {
  readonly payoutAddress: string;
  readonly amount: number | null;
}

interface OnchainTransferFormProps {
  direction: OnchainTransferDirection;
  config: OnchainConfig;
  /** The most an on-chain send can pay, moving funds between mints included. */
  payableSat: number;
  prefill: OnchainSendPrefill | null;
  /** Resolves once the request was handled; false keeps the form for another try. */
  onSubmit: (draft: NewOnchainTransferDraft) => Promise<boolean>;
  onContactSupport: () => void;
}

export function OnchainTransferForm({
  direction,
  config,
  payableSat,
  prefill,
  onSubmit,
  onContactSupport,
}: OnchainTransferFormProps): React.ReactElement {
  const { lang, t } = useTranslation();
  const { displayCurrency, formatDisplayedAmountText: amountText } =
    useDisplayAmounts();
  const { btc, exact, sats } = useExactAmountText();
  const send = direction === "send";
  const { feeBasisPoints } = config;
  const affordable = (amount: number) =>
    !send || amountWithServiceFee(amount, feeBasisPoints) <= payableSat;
  const [draft, setDraft] = React.useState<NewOnchainTransferDraft>(() => {
    const amount = prefill?.amount ?? null;
    return {
      direction,
      amount:
        amount !== null && config.amounts.includes(amount) && affordable(amount)
          ? amount
          : null,
      payoutAddress: prefill?.payoutAddress ?? "",
      refundAddress: "",
      refundToSender: true,
    };
  });
  const scannedAmount = prefill?.amount ?? null;
  const unavailableAmount =
    send && scannedAmount !== null && !config.amounts.includes(scannedAmount)
      ? scannedAmount
      : null;
  const [differentAmountChecked, setDifferentAmountChecked] =
    React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const change = (patch: Partial<NewOnchainTransferDraft>) =>
    setDraft((previous) => ({ ...previous, ...patch }));
  const problem = newOnchainTransferProblem(draft, config);
  const blocked =
    problem !== null || (unavailableAmount !== null && !differentAmountChecked);
  const feePercent = formatServiceFeePercent(feeBasisPoints, lang);
  const total =
    draft.amount === null
      ? null
      : amountWithServiceFee(draft.amount, feeBasisPoints);
  const networkFeeNotice = send
    ? draft.amount === null
      ? t("onchainSendNetworkFee")
      : t("onchainSendNetworkFeeAmount").replace(
          "{amount}",
          exact(draft.amount),
        )
    : total === null
      ? t("onchainReceiveNetworkFee")
      : t("onchainReceiveNetworkFeeAmount").replace(
          "{total}",
          `${sats(total)} (${btc(total)})`,
        );

  const submit = () => {
    if (blocked || busy) return;
    setBusy(true);
    void onSubmit(draft).then((requested) => {
      if (!requested) setBusy(false);
    });
  };

  const addressField = (
    field: "payoutAddress" | "refundAddress",
    label: string,
    hint?: string,
  ) => (
    <TextField
      label={label}
      hint={hint}
      value={draft[field]}
      onChangeText={(value) => change({ [field]: value })}
      autoCapitalize="none"
      autoCorrect={false}
      spellCheck={false}
      error={
        problem === "payoutAddressInvalid" || problem === "refundAddressInvalid"
          ? t("onchainTransferAddressInvalid")
          : undefined
      }
      testID={`onchain-transfer-${field}`}
    />
  );

  return (
    <Form onSubmit={submit}>
      <Text color="$colorSubtle">
        {t(send ? "onchainSendFixedAmounts" : "onchainReceiveFixedAmounts")}
      </Text>
      {config.amounts.some(affordable) ? null : (
        <Notice tone="warning" title={t("onchainSendInsufficient")} />
      )}
      {unavailableAmount === null ? null : (
        <>
          <Notice
            tone="warning"
            title={t("onchainSendAmountUnavailable").replace(
              "{amount}",
              exact(unavailableAmount),
            )}
            description={t("onchainSendAmountUnavailableHint")}
          />
          <ListRow
            title={t("onchainSendDifferentAmountChecked")}
            trailing={
              <Switch
                accessibilityLabel={t("onchainSendDifferentAmountChecked")}
                value={differentAmountChecked}
                onValueChange={setDifferentAmountChecked}
              />
            }
          />
        </>
      )}
      <Section title={t("onchainTransferChooseAmount")}>
        {config.amounts.map((amount) => {
          const lines = [
            displayCurrency === "sat" ? null : sats(amount),
            affordable(amount) ? null : t("payInsufficient"),
          ].flatMap((line) => line ?? []);
          return (
            <ListRow
              key={amount}
              title={amountText(amount)}
              description={
                lines.length === 0 ? undefined : (
                  <Stack>
                    {lines.map((line) => (
                      <Text key={line} variant="caption" color="$colorMuted">
                        {line}
                      </Text>
                    ))}
                  </Stack>
                )
              }
              selected={draft.amount === amount}
              disabled={!affordable(amount)}
              chevron={false}
              onPress={() => change({ amount })}
              testID="onchain-transfer-amount"
            />
          );
        })}
      </Section>
      {draft.amount === null || total === null ? null : (
        <OnchainTransferAmounts
          direction={direction}
          amount={draft.amount}
          fee={serviceFee(draft.amount, feeBasisPoints)}
          total={total}
          feePercent={feePercent}
        />
      )}
      {send ? (
        addressField("payoutAddress", t("onchainSendPayoutAddress"))
      ) : (
        <Section title={t("onchainTransferRefundAddress")}>
          <ListRow
            title={t("onchainReceiveRefundToSender")}
            selected={draft.refundToSender}
            chevron={false}
            onPress={() => change({ refundToSender: true })}
            testID="onchain-transfer-refund-sender"
          />
          <ListRow
            title={t("onchainReceiveUseCustomRefund")}
            selected={!draft.refundToSender}
            chevron={false}
            onPress={() => change({ refundToSender: false })}
            testID="onchain-transfer-custom-refund"
          />
          {draft.refundToSender ? (
            <Text variant="caption" color="$colorMuted">
              {t("onchainReceiveCustodialWarning")}
            </Text>
          ) : (
            addressField(
              "refundAddress",
              t("onchainReceiveRefundAddressField"),
              t("onchainReceiveRefundHint"),
            )
          )}
        </Section>
      )}
      <Notice
        tone="info"
        title={t(
          send ? "onchainSendArrivalNotice" : "onchainReceiveArrivalNotice",
        )}
        description={`${networkFeeNotice} ${t("onchainTransferFeeNotice").replace("{fee}", feePercent)}`}
        action={{
          label: t("onchainTransferContactSupport"),
          onPress: onContactSupport,
        }}
      />
      <SubmitButton
        disabled={blocked}
        loading={busy}
        testID="onchain-transfer-continue"
      >
        {t("onchainTransferContinue")}
      </SubmitButton>
    </Form>
  );
}

export function OnchainTransferNewPage({
  direction,
  prefill,
}: Pick<
  OnchainTransferFormProps,
  "direction" | "prefill"
>): React.ReactElement {
  const { t } = useTranslation();
  const shown = useOnchainTransfersShown();
  const configState = useOnchainConfig();
  const { cashuBalanceAfterMelt } = useWalletBalance();
  const { contactSupport, requestOnchainTransfer } =
    useOnchainTransferCommands();
  if (!shown || configState.status === "unavailable") {
    return <Notice tone="warning" title={t("onchainTransferUnavailable")} />;
  }
  if (configState.status === "loading") {
    return <LoadingState label={t("loading")} />;
  }
  const { config } = configState;
  const supportAction = {
    label: t("onchainTransferContactSupport"),
    onPress: () => contactSupport(null),
  };
  if (!isClientVersionSupported(config, __APP_VERSION__)) {
    return (
      <Stack gap="$md">
        <Notice
          tone="warning"
          title={t("onchainTransferUpdateRequired").replace(
            "{version}",
            config.minClientVersion ?? "",
          )}
          action={{
            label: t("pwaUpdateButton"),
            onPress: () => void applyPwaUpdate(),
          }}
        />
        <ListRow
          icon="MessageCircle"
          title={supportAction.label}
          onPress={supportAction.onPress}
        />
      </Stack>
    );
  }
  if (config.paused) {
    return (
      <Notice
        tone="warning"
        title={t("onchainTransferPaused")}
        action={supportAction}
      />
    );
  }
  return (
    <OnchainTransferForm
      direction={direction}
      config={config}
      payableSat={cashuBalanceAfterMelt}
      prefill={prefill}
      onSubmit={(draft) => requestOnchainTransfer(draft, config)}
      onContactSupport={supportAction.onPress}
    />
  );
}
