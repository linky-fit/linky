import { Dialog, QRCode, Stack, Text } from "@linky-fit/ui";
import React from "react";
import type { Translate } from "../i18n";
import { formatShortNpub } from "../utils/formatting";
import { optimizeCaseInsensitiveQrPayload } from "../utils/qrPayload";
import { OwnAvatar } from "./OwnSupporter";

interface ProfileShareOverlayProps {
  name: string | null;
  npub: string;
  onClose: () => void;
  pictureUrl: string | null;
  t: Translate;
}

const subscribeScreenOrientation = (onChange: () => void): (() => void) => {
  window.screen.orientation?.addEventListener("change", onChange);
  return () =>
    window.screen.orientation?.removeEventListener("change", onChange);
};

const isScreenUpsideDown = (): boolean =>
  window.screen.orientation?.angle === 180;

/**
 * Full-screen contact card shown while the phone is held top-down towards
 * another person. The content is rotated so they read it upright, unless the
 * OS already rotated the whole screen for them.
 */
export function ProfileShareOverlay({
  name,
  npub,
  onClose,
  pictureUrl,
  t,
}: ProfileShareOverlayProps): React.ReactElement {
  const screenUpsideDown = React.useSyncExternalStore(
    subscribeScreenOrientation,
    isScreenUpsideDown,
    () => false,
  );
  const displayName = name ?? formatShortNpub(npub);

  return (
    <Dialog
      open
      onOpenChange={onClose}
      title={t("myNpubQr")}
      hideTitle
      fullScreen
    >
      <Stack flex={1} justifyContent="center" onPress={onClose}>
        <Stack
          alignItems="center"
          rotate={screenUpsideDown ? "0deg" : "180deg"}
        >
          <OwnAvatar
            name={displayName}
            uri={pictureUrl ?? undefined}
            size="lg"
          />
          <Text variant="display" textAlign="center">
            {displayName}
          </Text>
          <QRCode
            value={optimizeCaseInsensitiveQrPayload(npub)}
            accessibilityLabel={t("myNpubQr")}
          />
        </Stack>
      </Stack>
    </Dialog>
  );
}
