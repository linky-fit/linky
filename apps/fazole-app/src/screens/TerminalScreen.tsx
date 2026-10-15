import {
  Amount,
  Button,
  IconButton,
  Keypad,
  Notice,
  Stack,
  Toast,
  ToastStack,
  TopBar,
  useMedia,
} from "@linky-fit/ui";
import { useEffect, useState } from "react";
import { copy } from "../copy";
import {
  canRequestPayment,
  directTransferCzk,
  formatKeypadInput,
  keypadAmount,
  pressKeypadKey,
  withTip,
  type DirectTransfer,
  type TipChoice,
} from "../domain";
import { formatCzk, formatWhole, numberSeparators } from "../format";
import { navigateTo } from "../platform/hashRoute";
import { paymentRoute } from "../routing";
import {
  useAppServices,
  useDirectTransfers,
  useOfferTips,
  usePayerName,
} from "../services/react";
import { nowSeconds } from "../utils/time";
import { TipStep } from "./TipStep";

/** The amount keypad, full screen; on phones the menu at the top leads to the other sections, wide screens show the rail. */
export function TerminalScreen() {
  const { payments } = useAppServices();
  const { wide } = useMedia();
  // Tips are offered until the merchant turns them off, also before the setting is read.
  const offerTips = useOfferTips() !== false;
  const [input, setInput] = useState("");
  const [tipping, setTipping] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [failed, setFailed] = useState(false);

  const request = async (tip: TipChoice) => {
    setRequesting(true);
    setFailed(false);
    try {
      const { amountCzk, tipCzk } = withTip(keypadAmount(input), tip);
      const payment = await payments.create(amountCzk, tipCzk);
      navigateTo(paymentRoute(payment.id));
    } catch (error) {
      console.warn("[fazole] payment not created", error);
      setFailed(true);
      setRequesting(false);
      setTipping(false);
    }
  };

  if (tipping) {
    return (
      <TipStep
        base={keypadAmount(input)}
        busy={requesting}
        onChoose={(tip) => void request(tip)}
        onBack={() => setTipping(false)}
      />
    );
  }

  return (
    <Stack flex={1} gap="$none" testID="terminal-screen">
      <TopBar
        trailing={
          wide ? undefined : (
            <IconButton
              testID="terminal-sections"
              icon="Menu"
              accessibilityLabel={copy.sections.history}
              onPress={() => navigateTo("history")}
            />
          )
        }
      />
      <Stack
        flex={1}
        width="100%"
        maxWidth="$sheetWidth"
        alignSelf="center"
        paddingHorizontal="$xl"
        paddingBottom="$xl"
        gap="$lg"
      >
        <Stack flex={1} justifyContent="center" minHeight="$hero">
          <Amount
            value={formatKeypadInput(input, numberSeparators)}
            unit={copy.czk}
            size="xl"
          />
        </Stack>
        {failed ? <Notice tone="danger" title={copy.terminal.failed} /> : null}
        <Keypad
          accessibilityLabel={copy.terminal.amount}
          decimal
          labels={{
            clear: copy.terminal.keypadClear,
            decimal: numberSeparators.decimal,
            delete: copy.terminal.keypadDelete,
          }}
          onKeyPress={(key) =>
            setInput((current) => pressKeypadKey(current, key))
          }
        />
        <Button
          testID="request-payment"
          icon="QrCode"
          minHeight="$controlLg"
          loading={requesting}
          disabled={!canRequestPayment(input)}
          onPress={() =>
            offerTips ? setTipping(true) : void request({ kind: "none" })
          }
        >
          {copy.terminal.request}
        </Button>
      </Stack>
      <DirectTransferNotice />
    </Stack>
  );
}

const NOTICE_MS = 6_000;

/** Tells the merchant about a direct transfer that arrives while the terminal is open, for a few seconds. */
function DirectTransferNotice() {
  const [openedAtSec] = useState(nowSeconds);
  const [newest] = useDirectTransfers();
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const fresh =
    newest !== undefined &&
    newest.receivedAtSec >= openedAtSec &&
    newest.id !== dismissedId
      ? newest
      : null;
  const freshId = fresh?.id ?? null;
  useEffect(() => {
    if (freshId === null) return;
    const timer = setTimeout(() => setDismissedId(freshId), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [freshId]);
  return fresh === null ? null : (
    <ToastStack>
      <DirectTransferToast
        transfer={fresh}
        onPress={() => setDismissedId(fresh.id)}
      />
    </ToastStack>
  );
}

function DirectTransferToast({
  transfer,
  onPress,
}: {
  readonly transfer: DirectTransfer;
  readonly onPress: () => void;
}) {
  const payer = usePayerName(transfer.payerPubkey);
  const czk = directTransferCzk(transfer);
  return (
    <Toast
      title={copy.terminal.directReceived(
        payer,
        czk === null
          ? copy.satAmount(formatWhole(transfer.sats))
          : formatCzk(czk),
      )}
      onPress={onPress}
    />
  );
}
