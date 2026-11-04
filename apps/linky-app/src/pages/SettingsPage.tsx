import {
  ListRow,
  Pill,
  Row,
  Section,
  Stack,
  Switch,
  Text,
} from "@linky-fit/ui";
import React from "react";
import { useTranslation } from "../app/hooks/shell";
import { useDisplaySettings } from "../app/hooks/settings/useDeviceSettings";
import {
  DISPLAY_CURRENCIES,
  getDisplayUnitLabel,
} from "../utils/displayAmounts";

export function SettingsPage(): React.ReactElement {
  const { lang, t } = useTranslation();
  const {
    allowedDisplayCurrencies,
    decimalAmountInputEnabled,
    displayCurrency,
    toggleAllowedDisplayCurrency,
    toggleDecimalAmountInput,
  } = useDisplaySettings();

  const unitLabel = (currency: (typeof DISPLAY_CURRENCIES)[number]) =>
    currency === "hidden"
      ? `${t("unitHidden")} (${getDisplayUnitLabel(currency, lang)})`
      : getDisplayUnitLabel(currency, lang);

  return (
    <Stack gap="$lg">
      <Stack gap="$sm">
        <Section grouped>
          {DISPLAY_CURRENCIES.map((currency) => {
            const isEnabled = allowedDisplayCurrencies.includes(currency);
            return (
              <ListRow
                key={currency}
                title={
                  <Row gap="$sm">
                    <Text>{unitLabel(currency)}</Text>
                    {displayCurrency === currency ? (
                      <Pill size="sm" label={t("unitCurrent")} />
                    ) : null}
                  </Row>
                }
                trailing={
                  <Switch
                    accessibilityLabel={`${t("unit")} ${unitLabel(currency)}`}
                    value={isEnabled}
                    disabled={isEnabled && allowedDisplayCurrencies.length <= 1}
                    onValueChange={() => toggleAllowedDisplayCurrency(currency)}
                  />
                }
              />
            );
          })}
        </Section>
        <Text variant="caption" color="$colorMuted" paddingHorizontal="$md">
          {t("unitManageInfo")}
        </Text>
      </Stack>
      <Section grouped>
        <ListRow
          title={t("decimalInput")}
          trailing={
            <Switch
              accessibilityLabel={t("decimalInput")}
              value={decimalAmountInputEnabled}
              onValueChange={toggleDecimalAmountInput}
            />
          }
        />
      </Section>
    </Stack>
  );
}
