import { Button, ListRow, QRCode, Stack, Switch, Text } from "@linky-fit/ui";
import { useState } from "react";
import { useTranslation } from "../app/hooks/shell";
import { useTokenQr } from "../app/hooks/cashu/useTokenQr";

interface CashuTokenQrProps {
  tokenText: string;
  copyText: (text: string) => Promise<void>;
}

export const CashuTokenQr = ({ tokenText, copyText }: CashuTokenQrProps) => {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [animationEnabled, setAnimationEnabled] = useState(true);
  const {
    frameCount: tokenQrFrameCount,
    value: tokenQr,
    canToggleAnimation,
    isTooLargeForStatic,
  } = useTokenQr(visible ? tokenText : "", animationEnabled);

  if (!visible) {
    return (
      <Button
        variant="secondary"
        onPress={() => setVisible(true)}
        disabled={!tokenText.trim()}
      >
        {t("cashuShowTokenQr")}
      </Button>
    );
  }

  return (
    <>
      {tokenQr ? (
        <Stack gap="$md">
          <QRCode
            value={tokenQr}
            accessibilityLabel={t("copy")}
            tooltip={t("copy")}
            onPress={() => void copyText(tokenText)}
          />
          {tokenQrFrameCount === null ? null : (
            <Text color="$colorMuted">
              {t("cashuTokenAnimatedQrHint").replace(
                "{frames}",
                String(tokenQrFrameCount),
              )}
            </Text>
          )}
        </Stack>
      ) : null}

      {canToggleAnimation ? (
        <>
          <ListRow
            title={t("cashuTokenAnimateQr")}
            trailing={
              <Switch
                accessibilityLabel={t("cashuTokenAnimateQr")}
                value={animationEnabled}
                onValueChange={setAnimationEnabled}
              />
            }
          />
          {!animationEnabled && isTooLargeForStatic ? (
            <Text color="$colorMuted">
              {t("cashuTokenStaticQrUnavailable")}
            </Text>
          ) : null}
        </>
      ) : null}
    </>
  );
};
