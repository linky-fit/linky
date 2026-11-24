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
import React from "react";
import { loadDevicePairing } from "../app/lib/devicePairing";
import { readThisDevice } from "../app/lib/thisDevice";
import { reportAppLog } from "../devtools/inspector/appLog";
import type { Translate } from "../i18n";

type JoinView =
  | { readonly phase: "scanning" }
  | PairingJoinState
  | { readonly phase: "restoring" };

/**
 * Signs this device in from another one that has the account: scans its
 * pairing QR code, shows the code to type there and, once the master secret
 * arrives, restores from it as from typed master keys.
 */
export const PairingJoinDialog = ({
  onClose,
  onShare,
  t,
}: {
  readonly onClose: () => void;
  /** Restores the account from the SLIP-39 share the received secret encodes. */
  readonly onShare: (share: string) => Promise<void>;
  readonly t: Translate;
}) => {
  const [view, setView] = React.useState<JoinView>({ phase: "scanning" });
  const session = React.useRef<PairingJoin | null>(null);

  React.useEffect(
    () => () => {
      session.current?.cancel();
    },
    [],
  );

  const onState = React.useCallback(
    (state: PairingJoinState) => {
      if (state.phase !== "received") {
        if (state.phase === "failed")
          reportAppLog({
            tag: "devices.pairingJoinEnded",
            summary: "Signing in from another device failed",
            payload: { reason: state.reason },
          });
        setView(state);
        return;
      }
      setView({ phase: "restoring" });
      reportAppLog({
        tag: "devices.pairingJoinEnded",
        summary: "Received the recovery seed from another device",
        payload: {},
      });
      void Effect.runPromise(
        slip39ShareFromMasterSecret(hexToBytes(state.payload.masterKey)),
      ).then(onShare, () => setView({ phase: "failed", reason: "invalid" }));
    },
    [onShare],
  );

  const onScan = (text: string): boolean => {
    const invite = parsePairingInvite(text);
    if (invite === null) return false;
    setView({ phase: "connecting" });
    reportAppLog({
      tag: "devices.pairingJoinStarted",
      summary: "Scanned another device's pairing QR code",
      payload: { relays: invite.r },
    });
    void loadDevicePairing().then(
      (pairing) => {
        session.current = pairing.join({
          invite,
          deviceId: readThisDevice().id,
          onState,
        });
      },
      () => setView({ phase: "failed", reason: "network" }),
    );
    return true;
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={t("pairJoin")}
      closeLabel={t("close")}
      testID="pairing-join-dialog"
      actions={
        view.phase === "failed" ? (
          <Button
            icon="ScanLine"
            onPress={() => setView({ phase: "scanning" })}
          >
            {t("devicesAddRetry")}
          </Button>
        ) : null
      }
    >
      <Stack gap="$lg">
        {view.phase === "scanning" ? (
          <>
            <QrScanner
              onScan={onScan}
              accessibilityLabel={t("pairJoinScanner")}
              unavailableLabel={t("pairJoinCameraUnavailable")}
            />
            <Text color="$colorMuted" textAlign="center">
              {t("pairJoinHint")}
            </Text>
          </>
        ) : null}
        {view.phase === "connecting" || view.phase === "restoring" ? (
          <Stack alignItems="center" gap="$sm" paddingVertical="$lg">
            <Spinner />
            {view.phase === "connecting" ? (
              <Text color="$colorMuted">{t("pairJoinConnecting")}</Text>
            ) : null}
          </Stack>
        ) : null}
        {view.phase === "code" ? (
          <Stack alignItems="center" gap="$sm" paddingVertical="$lg">
            <Text color="$colorMuted" textAlign="center">
              {t("pairJoinCode")}
            </Text>
            <Text variant="display" mono testID="pairing-join-code">
              {formatPairingCode(view.code)}
            </Text>
          </Stack>
        ) : null}
        {view.phase === "failed" ? (
          <Notice
            tone="danger"
            title={
              view.reason === "conflict"
                ? t("devicesAddConflict")
                : t("pairJoinFailed")
            }
          />
        ) : null}
      </Stack>
    </Dialog>
  );
};
