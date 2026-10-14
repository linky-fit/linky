import {
  Amount,
  Button,
  IconButton,
  Keypad,
  Notice,
  Stack,
  Text,
  TopBar,
} from "@linky-fit/ui";
import { useState } from "react";
import { copy } from "../copy";
import {
  canRequestPayment,
  formatKeypadInput,
  keypadAmount,
  pressKeypadKey,
  withTip,
  type ShopProfile,
  type TipChoice,
} from "../domain";
import { navigateTo } from "../platform/hashRoute";
import { paymentRoute } from "../routing";
import { useAppServices, useOfferTips } from "../services/react";
import { TipStep } from "./TipStep";

/** The amount keypad, full screen; the arrow at the top leads to the other sections. */
export function TerminalScreen({ shop }: { readonly shop: ShopProfile }) {
  const { payments } = useAppServices();
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
        content={
          <Text eyebrow textAlign="center" numberOfLines={1}>
            {shop.name}
          </Text>
        }
        trailing={
          <IconButton
            testID="terminal-sections"
            icon="ArrowRight"
            accessibilityLabel={copy.sections.history}
            onPress={() => navigateTo("history")}
          />
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
          <Amount value={formatKeypadInput(input)} unit={copy.czk} />
        </Stack>
        {failed ? <Notice tone="danger" title={copy.terminal.failed} /> : null}
        <Keypad
          accessibilityLabel={copy.terminal.amount}
          decimal
          labels={{
            clear: copy.terminal.keypadClear,
            decimal: copy.terminal.keypadDecimal,
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
    </Stack>
  );
}
