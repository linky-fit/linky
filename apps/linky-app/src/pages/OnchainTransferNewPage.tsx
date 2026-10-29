import {
  Button,
  Form,
  Icon,
  IconButton,
  ListRow,
  LoadingState,
  Notice,
  Row,
  Stack,
  SubmitButton,
  Switch,
  Text,
  TextField,
  type IconName,
} from "@linky-fit/ui";
import {
  amountWithServiceFee,
  isClientVersionSupported,
  type OnchainConfig,
  type OnchainTransferDirection,
} from "@linky-fit/onchain-transfer";
import React from "react";
import { useDisplayAmounts, useTranslation } from "../app/hooks/shell";
import {
  useOnchainConfig,
  useOnchainTransferCommands,
  useOnchainTransfers,
  useOnchainTransfersShown,
} from "../app/hooks/useOnchainTransfers";
import { useWalletBalance } from "../app/hooks/wallet/useWalletInventory";
import { formatServiceFeePercent } from "../app/lib/onchainTransferLabels";
import {
  newOnchainTransferProblem,
  openOnchainReceive,
  type NewOnchainTransferDraft,
} from "../app/lib/onchainTransfers";
import { DisplayAmount } from "../components/DisplayAmount";
import { useExactAmountText } from "../app/hooks/useExactAmountText";
import { navigateTo } from "../hooks/useRouting";
import { applyPwaUpdate } from "../utils/pwaUpdate";

/** A scanned payout address and amount for an on-chain send. */
export interface OnchainSendPrefill {
  readonly payoutAddress: string;
  readonly amount: number | null;
}

interface OnchainSendFormProps {
  config: OnchainConfig;
  /** The most an on-chain send can pay, moving funds between mints included. */
  payableSat: number;
  prefill: OnchainSendPrefill | null;
  /** Resolves once the request was handled; false keeps the form for another try. */
  onSubmit: (draft: NewOnchainTransferDraft) => Promise<boolean>;
}

/** The payout address and one amount: the largest the balance pays, stepped down or up among the operator's amounts. */
export function OnchainSendForm({
  config,
  payableSat,
  prefill,
  onSubmit,
}: OnchainSendFormProps): React.ReactElement {
  const { t } = useTranslation();
  const { formatDisplayedAmountText: amountText } = useDisplayAmounts();
  const { feeBasisPoints } = config;
  const total = (amount: number) =>
    amountWithServiceFee(amount, feeBasisPoints);
  const amounts = [...config.amounts].sort((a, b) => a - b);
  const affordable = amounts.filter((amount) => total(amount) <= payableSat);
  const scannedAmount = prefill?.amount ?? null;
  const [amount, setAmount] = React.useState<number | null>(() =>
    scannedAmount !== null && affordable.includes(scannedAmount)
      ? scannedAmount
      : (affordable.at(-1) ?? null),
  );
  const [payoutAddress, setPayoutAddress] = React.useState(
    prefill?.payoutAddress ?? "",
  );
  // The recipient asked for an amount the send cannot be made for; the user confirms they agreed on another.
  const unavailableAmount =
    scannedAmount !== null && scannedAmount !== amount ? scannedAmount : null;
  const [differentAmountChecked, setDifferentAmountChecked] =
    React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const draft: NewOnchainTransferDraft = {
    direction: "send",
    amount,
    payoutAddress,
  };
  const problem = newOnchainTransferProblem(draft, config);
  const blocked =
    problem !== null || (unavailableAmount !== null && !differentAmountChecked);
  const index = amount === null ? -1 : affordable.indexOf(amount);
  const step = (delta: -1 | 1) => {
    const next = affordable[index + delta];
    if (next !== undefined) setAmount(next);
  };

  const submit = () => {
    if (blocked || busy) return;
    setBusy(true);
    void onSubmit(draft).then((requested) => {
      if (!requested) setBusy(false);
    });
  };

  return (
    <Form onSubmit={submit}>
      <Text color="$colorSubtle">{t("onchainSendArrivalNotice")}</Text>
      {unavailableAmount === null ? null : (
        <>
          <Notice
            tone="warning"
            title={t("onchainSendAmountUnavailable").replace(
              "{amount}",
              amountText(unavailableAmount),
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
      {amount === null ? (
        <Notice
          tone="warning"
          title={t("onchainSendMinimum").replace(
            "{min}",
            amountText(total(amounts[0] ?? 0)),
          )}
        />
      ) : (
        <Stack alignItems="center" gap="$xs" paddingVertical="$lg">
          <Row alignItems="center" gap="$lg">
            <IconButton
              icon="Minus"
              variant="secondary"
              accessibilityLabel={t("onchainSendLowerAmount")}
              disabled={index <= 0}
              onPress={() => step(-1)}
              testID="onchain-transfer-amount-down"
            />
            <DisplayAmount
              amount={total(amount)}
              size="lg"
              testID="onchain-transfer-amount"
            />
            <IconButton
              icon="Plus"
              variant="secondary"
              accessibilityLabel={t("onchainSendHigherAmount")}
              disabled={index >= affordable.length - 1}
              onPress={() => step(1)}
              testID="onchain-transfer-amount-up"
            />
          </Row>
          <Text
            variant="caption"
            color="$colorMuted"
            testID="onchain-transfer-arriving"
          >
            {t("onchainSendArrivingAmount").replace(
              "{amount}",
              amountText(amount),
            )}
          </Text>
        </Stack>
      )}
      <TextField
        label={t("onchainSendPayoutAddress")}
        value={payoutAddress}
        onChangeText={setPayoutAddress}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        error={
          problem === "payoutAddressInvalid"
            ? t("onchainTransferAddressInvalid")
            : undefined
        }
        testID="onchain-transfer-payoutAddress"
      />
      <SubmitButton
        disabled={blocked}
        loading={busy}
        testID="onchain-transfer-continue"
      >
        {t("onchainSendSubmit")}
      </SubmitButton>
    </Form>
  );
}

interface OnchainReceiveIntroProps {
  config: OnchainConfig;
  busy: boolean;
  /** Shows the deposit address: an open one, or a fresh one from the operator. */
  onShowAddress: () => void;
}

/** What to know before depositing: how long it takes, the limits, the fee and where a refused deposit goes. */
export function OnchainReceiveIntro({
  config,
  busy,
  onShowAddress,
}: OnchainReceiveIntroProps): React.ReactElement {
  const { lang, t } = useTranslation();
  const { sats } = useExactAmountText();
  const min = config.minReceiveAmount;
  if (min === undefined) {
    return <Notice tone="warning" title={t("onchainTransferUnavailable")} />;
  }
  const points: ReadonlyArray<[IconName, string]> = [
    ["Clock", t("onchainReceiveIntroSettlement")],
    [
      "Bitcoin",
      t("onchainReceiveIntroRange")
        .replace("{min}", sats(min))
        .replace("{max}", sats(config.maxReceiveAmount)),
    ],
    [
      "Coins",
      t("onchainReceiveIntroFee").replace(
        "{fee}",
        formatServiceFeePercent(config.feeBasisPoints, lang),
      ),
    ],
    ["ArrowDownToLine", t("onchainReceiveIntroRefund")],
  ];
  return (
    <Stack gap="$lg">
      <Stack gap="$lg" paddingVertical="$md">
        {points.map(([icon, text]) => (
          <Row key={icon} gap="$md" alignItems="flex-start">
            <Icon name={icon} color="$colorMuted" />
            <Text flex={1}>{text}</Text>
          </Row>
        ))}
      </Stack>
      <Button
        icon="QrCode"
        loading={busy}
        onPress={onShowAddress}
        testID="onchain-receive-show-address"
      >
        {t("onchainReceiveShowAddress")}
      </Button>
    </Stack>
  );
}

export function OnchainTransferNewPage({
  direction,
  prefill,
}: {
  direction: OnchainTransferDirection;
  prefill: OnchainSendPrefill | null;
}): React.ReactElement {
  const { t } = useTranslation();
  const shown = useOnchainTransfersShown();
  const configState = useOnchainConfig();
  const transfers = useOnchainTransfers();
  const { cashuBalanceAfterMelt } = useWalletBalance();
  const { contactSupport, requestOnchainTransfer } =
    useOnchainTransferCommands();
  const [busy, setBusy] = React.useState(false);
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
  if (direction === "send") {
    return (
      <OnchainSendForm
        config={config}
        payableSat={cashuBalanceAfterMelt}
        prefill={prefill}
        onSubmit={(draft) => requestOnchainTransfer(draft, config)}
      />
    );
  }
  const showAddress = () => {
    if (busy) return;
    // The address stays the same until something arrives at it.
    const open = openOnchainReceive(transfers);
    if (open !== null) {
      navigateTo({ route: "onchainTransfer", id: open.id });
      return;
    }
    setBusy(true);
    void requestOnchainTransfer(
      { direction: "receive", amount: null, payoutAddress: "" },
      config,
    ).then((requested) => {
      if (!requested) setBusy(false);
    });
  };
  return (
    <OnchainReceiveIntro
      config={config}
      busy={busy}
      onShowAddress={showAddress}
    />
  );
}
