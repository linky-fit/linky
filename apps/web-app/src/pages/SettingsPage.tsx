import { Stack, Text, Row, ListRow, Switch, Pill } from "@linky-fit/ui";
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

  return (
    <Stack>
      <Text color="$colorMuted" variant="label">
        {t("unitManageInfo")}
      </Text>
      {DISPLAY_CURRENCIES.map((currency) => {
        const isEnabled = allowedDisplayCurrencies.includes(currency);
        return (
          <ListRow
            key={currency}
            title={
              <Row gap="$sm">
                <Text>{getDisplayUnitLabel(currency, lang)}</Text>
                {displayCurrency === currency ? (
                  <Pill size="sm" label={t("unitCurrent")} />
                ) : null}
              </Row>
            }
            trailing={
              <Switch
                accessibilityLabel={`${t("unit")} ${getDisplayUnitLabel(currency, lang)}`}
                value={isEnabled}
                disabled={isEnabled && allowedDisplayCurrencies.length <= 1}
                onValueChange={() => toggleAllowedDisplayCurrency(currency)}
              />
            }
          />
        );
      })}
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
    </Stack>
  );
}
