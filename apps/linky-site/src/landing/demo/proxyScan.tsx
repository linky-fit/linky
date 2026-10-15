import {
  Button,
  IconButton,
  MediaFrame,
  QRCode,
  Row,
  Stack,
  Text,
} from "@linky-fit/ui";
import { shadow } from "@linky-fit/ui/tokens";
import { noop } from "./noop";

export const bankQr =
  "SPD*1.0*ACC:CZ6508000000192000145399*AM:1250.00*CC:CZK*X-VS:20261003*MSG:Climbing pass*RN:Boulder Bar";

const corners = [
  { top: "$none", left: "$none", borderTopWidth: 4, borderLeftWidth: 4 },
  { top: "$none", right: "$none", borderTopWidth: 4, borderRightWidth: 4 },
  { bottom: "$none", left: "$none", borderBottomWidth: 4, borderLeftWidth: 4 },
  {
    bottom: "$none",
    right: "$none",
    borderBottomWidth: 4,
    borderRightWidth: 4,
  },
] as const;

/** A printed invoice with the bank QR, as the camera sees it. */
function Invoice() {
  return (
    <Stack
      className="proxy-handheld"
      alignItems="center"
      gap="$xs"
      padding="$md"
      borderRadius="$sm"
      backgroundColor="$qrBackground"
      boxShadow={shadow.floating}
    >
      <Text variant="caption" bold color="$qrForeground">
        Boulder Bar · Invoice 118
      </Text>
      {/* The QR tile is sized for screens; the camera sees it smaller. */}
      <Stack
        width={190}
        height={190}
        alignItems="center"
        justifyContent="center"
      >
        <Stack transform={[{ scale: 0.7 }]}>
          <QRCode value={bankQr} accessibilityLabel="Bank QR" />
        </Stack>
      </Stack>
      <Text variant="caption" bold color="$qrForeground">
        1,250.00 CZK
      </Text>
    </Stack>
  );
}

function Viewfinder({ locked }: { locked: boolean }) {
  return (
    <Stack
      key={String(locked)}
      className={locked ? "proxy-lock" : ""}
      position="absolute"
      width="$qr"
      height="$qr"
    >
      {corners.map((corner, index) => (
        <Stack
          key={index}
          position="absolute"
          width="$avatar"
          height="$avatar"
          borderRadius="$sm"
          borderColor={locked ? "$accent" : "$qrBackground"}
          {...corner}
        />
      ))}
      {locked ? null : (
        <Stack
          className="proxy-scanline"
          position="absolute"
          left="$md"
          right="$md"
          height={2}
          borderRadius="$pill"
          backgroundColor="$accent"
        />
      )}
    </Stack>
  );
}

/** The app's full-screen scanner, pointed at a bank QR. */
export function ScanScene({ locked }: { locked: boolean }) {
  return (
    <Stack flex={1} gap="$md" padding="$xl">
      <Row>
        <Text flex={1} variant="title">
          Scan
        </Text>
        <IconButton
          icon="X"
          size="sm"
          accessibilityLabel="Close"
          onPress={noop}
        />
      </Row>
      <MediaFrame accessibilityLabel="Camera preview" fill>
        <Stack
          className="proxy-camera"
          flex={1}
          alignItems="center"
          justifyContent="center"
          backgroundColor="$bezel"
        >
          <Invoice />
          <Viewfinder locked={locked} />
        </Stack>
      </MediaFrame>
      <Row gap="$sm">
        <Button
          variant="secondary"
          icon="ClipboardPaste"
          flex={1}
          onPress={noop}
        >
          Paste
        </Button>
        <Button variant="secondary" icon="Images" flex={1} onPress={noop}>
          Gallery
        </Button>
      </Row>
    </Stack>
  );
}
