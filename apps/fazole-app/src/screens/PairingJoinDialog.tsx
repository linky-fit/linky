import { slip39ShareFromMasterSecret } from "@linky-fit/identity";
import {
  formatPairingCode,
  parsePairingInvite,
  type PairingJoin,
  type PairingJoinState,
} from "@linky-fit/linkstr";
import {
  Button,
  Dialog,
  Notice,
  QrScanner,
  Spinner,
  Stack,
  Text,
} from "@linky-fit/ui";
import { hexToBytes } from "@noble/hashes/utils.js";
import { Effect } from "effect";
import { useEffect, useRef, useState } from "react";
import { copy } from "../copy";
import { loadDevicePairing } from "../platform/devicePairing";

type JoinView =
  | { readonly phase: "scanning" }
  | PairingJoinState
  | { readonly phase: "restoring" };

/**
 * Signs this device in from another one that has the shop: scans its pairing
 * QR code, shows the code to type there and, once the master secret arrives,
 * restores from the recovery seed it encodes.
 */
export function PairingJoinDialog({
  onClose,
  onRecoverySeed,
}: {
  readonly onClose: () => void;
  readonly onRecoverySeed: (recoverySeed: string) => Promise<void>;
}) {
  const [view, setView] = useState<JoinView>({ phase: "scanning" });
  const session = useRef<PairingJoin | null>(null);
  useEffect(() => () => session.current?.cancel(), []);

  const onState = (state: PairingJoinState) => {
    if (state.phase !== "received") {
      setView(state);
      return;
    }
    setView({ phase: "restoring" });
    void Effect.runPromise(
      slip39ShareFromMasterSecret(hexToBytes(state.payload.masterKey)),
    ).then(onRecoverySeed, () =>
      setView({ phase: "failed", reason: "invalid" }),
    );
  };

  const onScan = (text: string): boolean => {
    const invite = parsePairingInvite(text);
    if (invite === null) return false;
    setView({ phase: "connecting" });
    void loadDevicePairing().then(
      (pairing) => {
        session.current = pairing.join({ invite, onState });
      },
      () => setView({ phase: "failed", reason: "network" }),
    );
    return true;
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={copy.devices.join}
      closeLabel={copy.close}
      testID="pairing-join-dialog"
    >
      <Stack gap="$lg">
        {view.phase === "scanning" ? (
          <>
            <QrScanner
              onScan={onScan}
              accessibilityLabel={copy.devices.scanner}
              unavailableLabel={copy.devices.scannerUnavailable}
            />
            <Text color="$colorMuted" textAlign="center">
              {copy.devices.joinHint}
            </Text>
          </>
        ) : null}
        {view.phase === "connecting" || view.phase === "restoring" ? (
          <Stack alignItems="center" gap="$sm" paddingVertical="$lg">
            <Spinner />
            {view.phase === "connecting" ? (
              <Text color="$colorMuted">{copy.devices.connecting}</Text>
            ) : null}
          </Stack>
        ) : null}
        {view.phase === "code" ? (
          <Stack alignItems="center" gap="$sm" paddingVertical="$lg">
            <Text color="$colorMuted" textAlign="center">
              {copy.devices.joinCode}
            </Text>
            <Text variant="display" mono testID="pairing-join-code">
              {formatPairingCode(view.code)}
            </Text>
          </Stack>
        ) : null}
        {view.phase === "failed" ? (
          <>
            <Notice
              tone="danger"
              title={
                view.reason === "conflict"
                  ? copy.devices.conflict
                  : copy.devices.joinFailed
              }
            />
            <Button
              icon="ScanLine"
              onPress={() => setView({ phase: "scanning" })}
            >
              {copy.retry}
            </Button>
          </>
        ) : null}
      </Stack>
    </Dialog>
  );
}
