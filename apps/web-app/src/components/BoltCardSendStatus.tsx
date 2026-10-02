import { Nfc as NfcIcon } from "lucide-react";
import React from "react";
import {
  useAppShellCore,
  useMoneyRoutes,
} from "../app/context/AppShellContexts";
import { useBoltCardArmOnSend } from "../app/hooks/useBoltCardArmOnSend";
import {
  useBoltCardSession,
  type BoltCardSessionError,
  type BoltCardSessionPhase,
} from "../app/hooks/useBoltCardSession";
import { getBoltCardBridgeUrl } from "../app/lib/boltCardStorage";
import { estimateMaxWithdrawableSat } from "../app/lib/boltCardTapSession";
import type { I18nKey } from "../i18n";
import { supportsNativeBoltCard } from "../platform/nativeBridge";

const ERROR_KEYS: Record<BoltCardSessionError, I18nKey> = {
  unsupported: "boltCardErrorUnsupported",
  nfcDisabled: "boltCardErrorNfcDisabled",
  bridge: "boltCardErrorBridge",
  storage: "boltCardErrorStorage",
  exhausted: "boltCardErrorExhausted",
  native: "boltCardErrorNative",
};

const statusKey = (phase: BoltCardSessionPhase): I18nKey => {
  switch (phase.kind) {
    case "idle":
    case "connecting":
      return "boltCardConnecting";
    case "ready":
      return "boltCardSendActive";
    case "paying":
      return "boltCardPaying";
    case "ended":
      return "boltCardEnded";
    case "failed":
      return ERROR_KEYS[phase.error];
  }
};

/** Arms the card while mounted; the Send screen mounts it only when enabled. */
function ArmedBoltCard(): React.ReactElement {
  const { cashuBalance, formatDisplayedAmountText, t } = useAppShellCore();
  const submitInvoice = useMoneyRoutes().manualPayProps.onSubmitText;
  const [bridgeUrl] = React.useState(getBoltCardBridgeUrl);

  // The scanned-invoice path closes Send and pays: auto-pay up to the
  // limit, a confirmation above it.
  const onInvoice = React.useCallback(
    (invoice: string) => void submitInvoice(invoice),
    [submitInvoice],
  );
  const { phase, start } = useBoltCardSession({
    bridgeUrl,
    spendableSat: cashuBalance,
    onInvoice,
  });

  React.useEffect(() => {
    void start();
  }, [start]);

  const canRetry = phase.kind === "ended" || phase.kind === "failed";
  return (
    <div
      className={`scan-bolt-card-status is-${phase.kind}`}
      role="status"
      aria-live="polite"
    >
      <NfcIcon size={18} aria-hidden="true" />
      <span className="scan-bolt-card-status-text">
        {t(statusKey(phase)).replace(
          "{amount}",
          formatDisplayedAmountText(estimateMaxWithdrawableSat(cashuBalance)),
        )}
      </span>
      {canRetry ? (
        <button
          type="button"
          className="scan-bolt-card-retry"
          onClick={() => void start()}
        >
          {t("boltCardRetry")}
        </button>
      ) : null}
    </div>
  );
}

/**
 * The bolt card row of the Send screen: armed when this device can emulate a
 * card and the synced "arm on Send" switch is on, absent otherwise.
 */
export function BoltCardSendStatus(): React.ReactElement | null {
  const { armOnSend } = useBoltCardArmOnSend();
  return armOnSend && supportsNativeBoltCard() ? <ArmedBoltCard /> : null;
}
