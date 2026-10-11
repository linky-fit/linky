import { Button, CodeBlock, EmptyState, QRCode, Stack } from "@linky-fit/ui";
import React from "react";
import { useCopyText, useTranslation } from "../app/hooks/shell";

interface TopupNoAmountPageProps {
  /** The user's own lightning address, which takes any amount. */
  lightningAddress: string | null;
}

export function TopupNoAmountPage({
  lightningAddress,
}: TopupNoAmountPageProps): React.ReactElement {
  const copyText = useCopyText();
  const { t } = useTranslation();
  const target = (lightningAddress ?? "").trim();

  return (
    <Stack gap="$lg">
      {target ? (
        <Stack gap="$lg">
          <QRCode
            value={target}
            accessibilityLabel={t("copy")}
            badge="Copy"
            onPress={() => void copyText(target)}
          />
          <CodeBlock>{target}</CodeBlock>
          <Button
            variant="secondary"
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
