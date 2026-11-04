import { Button, EmptyState, QRCode, Stack, Text } from "@linky-fit/ui";
import React from "react";
import { useEffectiveProfile } from "../app/hooks/profile/useEffectiveProfile";
import { useCopyText, useTranslation } from "../app/hooks/shell";
import { formatShortLightningAddress } from "../utils/formatting";

/** The user's own lightning address, which takes any amount. */
export function TopupNoAmountPage(): React.ReactElement {
  const copyText = useCopyText();
  const { t } = useTranslation();
  const target = (
    useEffectiveProfile().effectiveMyLightningAddress ?? ""
  ).trim();

  return (
    <Stack gap="$lg">
      {target ? (
        <Stack gap="$lg">
          <QRCode
            value={target}
            accessibilityLabel={t("copy")}
            onPress={() => void copyText(target)}
          />
          <Text
            variant="label"
            color="$colorSubtle"
            textAlign="center"
            userSelect="text"
          >
            {formatShortLightningAddress(target)}
          </Text>
          <Button
            icon="Copy"
            testID="topup-invoice-copy"
            onPress={() => void copyText(target)}
          >
            {t("copy")}
          </Button>
        </Stack>
      ) : (
        <EmptyState title={t("topupNoAmountMissingAddress")} />
      )}
    </Stack>
  );
}
