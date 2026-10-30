import {
  Amount,
  Button,
  IconButton,
  Keypad,
  OptionTile,
  Row,
  Stack,
  Text,
  TopBar,
} from "@linky-fit/ui";
import { useState } from "react";
import type { ReactNode } from "react";
import { copy } from "../../copy";
import { DemoScreen, Page } from "../chrome";
import {
  formatTyped,
  pressKey,
  TIP_PRESETS,
  typedHalere,
  withTip,
} from "../money";
import type { TipChoice } from "../money";
import { czk } from "../labels";
import { useDemo } from "../store";

const t = copy.demo;

const keypadLabels = {
  clear: t.terminal.keypadClear,
  decimal: t.terminal.keypadDecimal,
  delete: t.terminal.keypadDelete,
};

/** Where a terminal opens: empty, or with an amount on the tip step. */
export interface TerminalStart {
  readonly input: string;
  readonly tipping: boolean;
}

/** The terminal, full screen like the app's: type an amount, let the customer tip, open the payment. */
export function TerminalMock({
  start,
  banner,
  onOpenPayment,
  onOpenSections,
}: {
  start: TerminalStart;
  /** A payment that just arrived, announced over the keypad like the app does. */
  banner?: ReactNode;
  onOpenPayment: (id: string) => void;
  onOpenSections: () => void;
}) {
  const { requestPayment, offerTips } = useDemo();
  const [input, setInput] = useState(start.input);
  const [tipping, setTipping] = useState(start.tipping);
  const base = typedHalere(input);

  const request = (tip: TipChoice) => {
    const { totalHalere, tipHalere } = withTip(base, tip);
    onOpenPayment(requestPayment(totalHalere, tipHalere).id);
  };

  if (tipping) {
    return (
      <TipStep
        base={base}
        onChoose={request}
        onBack={() => setTipping(false)}
      />
    );
  }
  return (
    <DemoScreen overlay={banner}>
      <TopBar
        trailing={
          <IconButton
            icon="Menu"
            accessibilityLabel={t.sections.history}
            onPress={onOpenSections}
          />
        }
      />
      <Stack flex={1} paddingHorizontal="$xl" paddingBottom="$xl" gap="$lg">
        <Stack flex={1} justifyContent="center" minHeight="$hero">
          <Amount value={formatTyped(input)} unit={t.czk} size="xl" />
        </Stack>
        <Keypad
          accessibilityLabel={t.terminal.amount}
          decimal
          labels={keypadLabels}
          onKeyPress={(key) => setInput((current) => pressKey(current, key))}
        />
        <Button
          icon="QrCode"
          minHeight="$controlLg"
          disabled={base === 0}
          onPress={() =>
            offerTips ? setTipping(true) : request({ kind: "none" })
          }
        >
          {t.terminal.request}
        </Button>
      </Stack>
    </DemoScreen>
  );
}

type Tile = { kind: "choice"; choice: TipChoice } | { kind: "custom" };

const tiles: readonly Tile[] = [
  ...TIP_PRESETS.map((choice): Tile => ({ kind: "choice", choice })),
  { kind: "custom" },
  { kind: "choice", choice: { kind: "none" } },
];

const tileRows = tiles.flatMap((_tile, index) =>
  index % 2 === 0 ? [tiles.slice(index, index + 2)] : [],
);

const choiceLabel = (choice: TipChoice): string =>
  choice.kind === "percent"
    ? t.tips.percent(choice.percent)
    : choice.kind === "fixed"
      ? t.tips.fixed(String(choice.tipHalere / 100))
      : t.tips.none;

const tileLabel = (tile: Tile): string =>
  tile.kind === "custom" ? t.tips.custom : choiceLabel(tile.choice);

/** "Chcete přidat spropitné?": presets with the total each charges, a custom tip, or none. */
function TipStep({
  base,
  onChoose,
  onBack,
}: {
  base: number;
  onChoose: (choice: TipChoice) => void;
  onBack: () => void;
}) {
  const [custom, setCustom] = useState<string | null>(null);
  const total = (choice: TipChoice) => czk(withTip(base, choice).totalHalere);

  if (custom !== null) {
    const tip = typedHalere(custom);
    return (
      <DemoScreen>
        <TopBar
          title={t.tips.custom}
          leading={
            <IconButton
              icon="ArrowLeft"
              accessibilityLabel={t.back}
              onPress={() => setCustom(null)}
            />
          }
        />
        <Stack flex={1} paddingHorizontal="$xl" paddingBottom="$xl" gap="$lg">
          <Stack flex={1} justifyContent="center" minHeight="$hero">
            <Amount
              value={formatTyped(custom)}
              unit={t.czk}
              caption={t.tips.customTotal(
                total({ kind: "fixed", tipHalere: tip }),
              )}
            />
          </Stack>
          <Keypad
            accessibilityLabel={t.tips.custom}
            decimal
            labels={keypadLabels}
            onKeyPress={(key) =>
              setCustom((current) => pressKey(current ?? "", key))
            }
          />
          <Button
            minHeight="$controlLg"
            disabled={tip === 0}
            onPress={() => onChoose({ kind: "fixed", tipHalere: tip })}
          >
            {t.tips.confirm}
          </Button>
        </Stack>
      </DemoScreen>
    );
  }
  return (
    <DemoScreen>
      <TopBar
        leading={
          <IconButton
            icon="ArrowLeft"
            accessibilityLabel={t.back}
            onPress={onBack}
          />
        }
      />
      <Page centered>
        <Stack alignItems="center" gap="$sm">
          <Text variant="heading" textAlign="center" role="heading">
            {t.tips.title}
          </Text>
          <Text color="$colorMuted" textAlign="center">
            {t.tips.base(czk(base))}
          </Text>
        </Stack>
        <Stack gap="$md">
          {tileRows.map((row) => (
            <Row key={row.map(tileLabel).join()} gap="$md" alignItems="stretch">
              {row.map((tile) => (
                <OptionTile
                  key={tileLabel(tile)}
                  flex={1}
                  minHeight="$row"
                  label={tileLabel(tile)}
                  onPress={() =>
                    tile.kind === "custom"
                      ? setCustom("")
                      : onChoose(tile.choice)
                  }
                >
                  <Text
                    variant="title"
                    textAlign="center"
                    color={
                      tile.kind === "custom" ? "$colorMuted" : "$colorStrong"
                    }
                  >
                    {tile.kind === "custom"
                      ? t.tips.customHint
                      : total(tile.choice)}
                  </Text>
                </OptionTile>
              ))}
            </Row>
          ))}
        </Stack>
      </Page>
    </DemoScreen>
  );
}
