import { Button, Dialog, Icon, Pill, Stack, Text } from "@linky-fit/ui";
import React from "react";
import { useTranslation } from "../app/hooks/shell";

interface OwnLightningAddressClaimedModalProps {
  lightningAddress: string;
  onClose: () => void;
}

/** Thanks the user for a bought linky.fit address and shows what they can do with it. */
export function OwnLightningAddressClaimedModal({
  lightningAddress,
  onClose,
}: OwnLightningAddressClaimedModalProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("claimOwnLightningAddressCongratsTitle")}
      testID="profile-own-ln-address-claimed"
      actions={
        <Button onPress={onClose}>
          {t("claimOwnLightningAddressCongratsAction")}
        </Button>
      }
    >
      <Stack gap="$md" alignItems="center">
        <Pill label={lightningAddress} leading={<Icon name="Zap" />} />
        <Text color="$colorSubtle" textAlign="center">
          {t("claimOwnLightningAddressCongratsBody")}
        </Text>
      </Stack>
    </Dialog>
  );
}
