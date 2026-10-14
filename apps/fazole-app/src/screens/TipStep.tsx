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
import { copy } from "../copy";
import {
  canRequestPayment,
  formatKeypadInput,
  keypadAmount,
  pressKeypadKey,
  TIP_PRESETS,
  withTip,
  type CzkAmount,
  type TipChoice,
} from "../domain";
import { formatCzk, numberSeparators } from "../format";
import { Page, WithTopBar } from "./Page";

const presetLabel = (choice: TipChoice): string => {
  switch (choice.kind) {
    case "percent":
      return copy.tips.percent(choice.percent);
    case "fixed":
      return copy.tips.fixed(String(choice.tipCzk / 100));
    case "none":
      return copy.tips.none;
  }
};

type Tile =
  | { readonly kind: "choice"; readonly choice: TipChoice }
  | { readonly kind: "custom" };

const tiles: readonly Tile[] = [
  ...TIP_PRESETS.map((choice): Tile => ({ kind: "choice", choice })),
  { kind: "custom" },
  { kind: "choice", choice: { kind: "none" } },
];

const tileRows = tiles.flatMap((_tile, index) =>
  index % 2 === 0 ? [tiles.slice(index, index + 2)] : [],
);

/** The customer picks a tip before the payment QR: a preset, their own amount, or none. */
export function TipStep({
  base,
  busy,
  onChoose,
  onBack,
}: {
  readonly base: CzkAmount;
  readonly busy: boolean;
  readonly onChoose: (choice: TipChoice) => void;
  readonly onBack: () => void;
}) {
  const [custom, setCustom] = useState<string | null>(null);
  const total = (choice: TipChoice) =>
    formatCzk(withTip(base, choice).amountCzk);

  if (custom !== null) {
    const tip = keypadAmount(custom);
    return (
      <WithTopBar
        topBar={
          <TopBar
            title={copy.tips.custom}
            leading={
              <IconButton
                icon="ArrowLeft"
                accessibilityLabel={copy.back}
                onPress={() => setCustom(null)}
              />
            }
          />
        }
      >
        <Stack
          flex={1}
          width="100%"
          maxWidth="$sheetWidth"
          alignSelf="center"
          paddingHorizontal="$xl"
          paddingBottom="$xl"
          gap="$lg"
          testID="tip-custom"
        >
          <Stack flex={1} justifyContent="center" minHeight="$hero">
            <Amount
              value={formatKeypadInput(custom, numberSeparators)}
              unit={copy.czk}
              caption={copy.tips.customTotal(
                total({ kind: "fixed", tipCzk: tip }),
              )}
            />
          </Stack>
          <Keypad
            accessibilityLabel={copy.tips.custom}
            decimal
            labels={{
              clear: copy.terminal.keypadClear,
              decimal: numberSeparators.decimal,
              delete: copy.terminal.keypadDelete,
            }}
            onKeyPress={(key) =>
              setCustom((current) => pressKeypadKey(current ?? "", key))
            }
          />
          <Button
            testID="tip-custom-confirm"
            minHeight="$controlLg"
            loading={busy}
            disabled={!canRequestPayment(custom)}
            onPress={() => onChoose({ kind: "fixed", tipCzk: tip })}
          >
            {copy.tips.confirm}
          </Button>
        </Stack>
      </WithTopBar>
    );
  }

  return (
    <WithTopBar
      topBar={
        <TopBar
          leading={
            <IconButton
              testID="tip-back"
              icon="ArrowLeft"
              accessibilityLabel={copy.back}
              onPress={onBack}
            />
          }
        />
      }
    >
      <Page centered testID="tip-step">
        <Stack alignItems="center" gap="$sm">
          <Text variant="heading" textAlign="center" role="heading">
            {copy.tips.title}
          </Text>
          <Text color="$colorMuted" textAlign="center">
            {copy.tips.base(formatCzk(base))}
          </Text>
        </Stack>
        <Stack gap="$md">
          {tileRows.map((row) => (
            <Row key={row.map(tileKey).join()} gap="$md" alignItems="stretch">
              {row.map((tile) => (
                <OptionTile
                  key={tileKey(tile)}
                  testID={`tip-${tileKey(tile)}`}
                  flex={1}
                  minHeight="$row"
                  disabled={busy}
                  label={
                    tile.kind === "custom"
                      ? copy.tips.custom
                      : presetLabel(tile.choice)
                  }
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
                      ? copy.tips.customHint
                      : total(tile.choice)}
                  </Text>
                </OptionTile>
              ))}
            </Row>
          ))}
        </Stack>
      </Page>
    </WithTopBar>
  );
}

const tileKey = (tile: Tile): string => {
  if (tile.kind === "custom") return "custom";
  const { choice } = tile;
  switch (choice.kind) {
    case "percent":
      return `${choice.percent}pct`;
    case "fixed":
      return `${choice.tipCzk / 100}czk`;
    case "none":
      return "none";
  }
};
