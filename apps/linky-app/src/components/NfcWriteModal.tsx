import { Button, Dialog, Icon, Stack, Text, border } from "@linky-fit/ui";
import React from "react";

import type { Translate } from "../i18n";

interface NfcWriteModalProps {
  kind: "profile" | "token";
  onCancel: () => void;
  t: Translate;
}

function NfcWriteIllustration(): React.ReactElement {
  return (
    <Stack
      aria-hidden
      width="$qr"
      height="$qr"
      alignSelf="center"
      alignItems="center"
      justifyContent="center"
      borderRadius="$pill"
      borderWidth={border.emphasis}
      borderColor="$info"
      backgroundColor="$infoSoft"
    >
      <Stack
        width="$controlLg"
        height="$hero"
        padding="$sm"
        borderRadius="$card"
        backgroundColor="$background"
      >
        <Stack flex={1} borderRadius="$sm" backgroundColor="$infoSoft" />
      </Stack>
      <Stack position="absolute">
        <Icon name="Radio" size="xl" color="$info" />
      </Stack>
    </Stack>
  );
}

export function NfcWriteModal({
  kind,
  onCancel,
  t,
}: NfcWriteModalProps): React.ReactElement {
  const detailKey =
    kind === "profile" ? "nfcWriteReadyProfileBody" : "nfcWriteReadyTokenBody";
  const actionKey =
    kind === "profile" ? "nfcWriteProfileLabel" : "nfcWriteTokenLabel";

  return (
    <Dialog
      open
      onOpenChange={onCancel}
      title={t("nfcWriteReadyTitle")}
      description={t("nfcWriteReadySubtitle")}
      actions={
        <Button variant="secondary" onPress={onCancel}>
          {t("payCancel")}
        </Button>
      }
    >
      <Stack paddingVertical="$xxl">
        <NfcWriteIllustration />
      </Stack>
      <Stack alignItems="center" gap="$sm" paddingBottom="$lg">
        <Text eyebrow color="$infoText" textAlign="center">
          {t(actionKey)}
        </Text>
        <Text color="$colorMuted" textAlign="center">
          {t(detailKey)}
        </Text>
      </Stack>
    </Dialog>
  );
}
