import {
  recoverMasterSecretFromSlip39Share,
  parseSlip39Share,
} from "@linky-fit/identity";
import {
  type PairingOffer,
  type PairingOfferState,
  type PairingPayload,
} from "@linky-fit/linkstr";
import { useAtomValue } from "@linky-fit/linkstr-react";
import { type DeviceId, type LinkedDeviceRecord } from "@linky-fit/linksync";
import {
  Button,
  Card,
  CodeField,
  Dialog,
  ListRow,
  Notice,
  Pill,
  QRCode,
  Spinner,
  Stack,
  Text,
  TextField,
} from "@linky-fit/ui";
import { bytesToHex } from "@noble/hashes/utils.js";
import { Effect } from "effect";
import React from "react";
import { useSeedMnemonic } from "../app/hooks/settings/useIdentitySettings";
import { usePushToast, useTranslation } from "../app/hooks/shell";
import {
  useDeviceRecords,
  useDevicesRepository,
} from "../app/hooks/useLinksync";
import { deviceAppName } from "../app/lib/deviceApps";
import { loadDevicePairing, pairingRelays } from "../app/lib/devicePairing";
import { readThisDevice } from "../app/lib/thisDevice";
import { myProfileAtom } from "../app/state/contacts/profiles";
import { evoluRelaySettingsAtom } from "../app/state/session/evolu";
import { reportAppLog } from "../devtools/inspector/appLog";
import type { Translate } from "../i18n";
import { getUnknownErrorMessage } from "../utils/unknown";

const describe = (device: LinkedDeviceRecord): string =>
  [deviceAppName(device.app), device.browserName, device.osName]
    .filter((part) => part !== null && part !== "")
    .join(" · ");

/** This device first, then by app and name. */
const sortDevices = (
  devices: ReadonlyArray<LinkedDeviceRecord>,
  thisDeviceId: DeviceId,
): ReadonlyArray<LinkedDeviceRecord> =>
  [...devices].sort(
    (a, b) =>
      Number(b.id === thisDeviceId) - Number(a.id === thisDeviceId) ||
      a.app.localeCompare(b.app) ||
      a.name.localeCompare(b.name),
  );

/** What the new device receives: the master secret behind the seed, a name and this app's sync servers. */
const pairingPayload = async (
  seed: string,
  accountName: string | null,
  syncServers: ReadonlyArray<string>,
): Promise<PairingPayload> => {
  const secret = await Effect.runPromise(
    Effect.flatMap(parseSlip39Share(seed), (share) =>
      recoverMasterSecretFromSlip39Share(share),
    ),
  );
  return {
    masterKey: bytesToHex(secret),
    accountName: accountName?.trim().slice(0, 255) || "Linky",
    transports: syncServers
      .filter((url) => url.startsWith("wss://"))
      .slice(0, 8),
  };
};

const offerMessage = (
  state: PairingOfferState,
  t: Translate,
): {
  readonly tone: "danger" | "accent" | "info";
  readonly text: string;
} | null => {
  switch (state.phase) {
    case "expired":
      return { tone: "info", text: t("devicesAddExpired") };
    case "failed":
      return {
        tone: "danger",
        text:
          state.reason === "conflict"
            ? t("devicesAddConflict")
            : state.reason === "cancelled"
              ? t("devicesAddExpired")
              : t("devicesAddFailed"),
      };
    default:
      return null;
  }
};

/** Shows the pairing QR code, then takes the code the new device shows; closes with a toast once the device has the seed. */
const AddDeviceDialog = ({ onClose }: { readonly onClose: () => void }) => {
  const { t } = useTranslation();
  const pushToast = usePushToast();
  const seed = useSeedMnemonic();
  const myProfileName = useAtomValue(myProfileAtom, (my) => my.name);
  const evoluRelaySettings = useAtomValue(evoluRelaySettingsAtom);
  const [state, setState] = React.useState<PairingOfferState | null>(null);
  const [code, setCode] = React.useState("");
  const [attempt, setAttempt] = React.useState(0);
  const session = React.useRef<PairingOffer | null>(null);

  React.useEffect(() => {
    if (seed === null) return;
    let cancelled = false;
    void (async () => {
      const [pairing, payload] = await Promise.all([
        loadDevicePairing(),
        pairingPayload(seed, myProfileName, evoluRelaySettings.activeUrls()),
      ]);
      if (cancelled) return;
      reportAppLog({
        tag: "devices.pairingOffered",
        summary: "Showing a QR code that adds a device to the recovery seed",
        payload: { relays: pairingRelays() },
      });
      session.current = pairing.offer({
        payload,
        relays: pairingRelays(),
        onState: (next) => {
          if (next.phase === "done" || next.phase === "failed")
            reportAppLog({
              tag: "devices.pairingEnded",
              summary:
                next.phase === "done"
                  ? "A new device received the recovery seed"
                  : "Adding a device ended without sending the recovery seed",
              payload:
                next.phase === "done"
                  ? { acked: next.acked, deviceId: next.deviceId }
                  : { reason: next.reason },
            });
          if (next.phase === "done") {
            pushToast(t("devicesAddDone"));
            onClose();
            return;
          }
          setState(next);
        },
      });
    })().catch((error: unknown) => {
      if (!cancelled) setState({ phase: "failed", reason: "network" });
      reportAppLog({
        tag: "devices.pairingEnded",
        summary: "Adding a device could not start",
        payload: { error: String(error) },
      });
    });
    return () => {
      cancelled = true;
      session.current?.cancel();
      session.current = null;
    };
    // A new attempt starts a new session; the seed and servers stay for the dialog's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const message = state === null ? null : offerMessage(state, t);
  const over = state?.phase === "failed" || state?.phase === "expired";

  return (
    <Dialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={t("devicesAdd")}
      closeLabel={t("close")}
      testID="add-device-dialog"
      actions={
        over ? (
          <Stack gap="$sm">
            <Button
              icon="QrCode"
              onPress={() => {
                setState(null);
                setCode("");
                setAttempt((current) => current + 1);
              }}
            >
              {t("devicesAddRetry")}
            </Button>
            <Button variant="secondary" onPress={onClose}>
              {t("close")}
            </Button>
          </Stack>
        ) : null
      }
    >
      <Stack gap="$lg">
        {state === null || state.phase === "sending" ? (
          <Stack alignItems="center" gap="$sm" paddingVertical="$lg">
            <Spinner />
            {state?.phase === "sending" ? (
              <Text color="$colorMuted">{t("devicesAddSending")}</Text>
            ) : null}
          </Stack>
        ) : null}
        {state?.phase === "waiting" ? (
          <>
            <QRCode
              value={state.invite}
              accessibilityLabel={t("devicesAdd")}
              testID="add-device-qr"
            />
            <Text color="$colorMuted" textAlign="center">
              {t("devicesAddScanHint")}
            </Text>
            <Notice tone="warning" title={t("devicesAddWarning")} />
          </>
        ) : null}
        {state?.phase === "locked" ? (
          <>
            <CodeField
              testID="add-device-code"
              label={t("devicesAddCodeLabel")}
              hint={t("devicesAddCodeHint")}
              error={
                state.mismatch
                  ? t("devicesAddCodeMismatch").replace(
                      "{count}",
                      String(state.attemptsLeft),
                    )
                  : undefined
              }
              value={code}
              onChangeText={(next) => {
                if (next.length < 6) {
                  setCode(next);
                  return;
                }
                session.current?.submitCode(next);
                // A mismatch starts the next attempt from empty boxes.
                setCode("");
              }}
              autoFocus
            />
            <Notice tone="warning" title={t("devicesAddWarning")} />
          </>
        ) : null}
        {message === null ? null : (
          <Notice tone={message.tone} title={message.text} />
        )}
      </Stack>
    </Dialog>
  );
};

/** Renames a device, or removes another one, which signs it out. */
const DeviceDialog = ({
  device,
  thisDeviceId,
  onClose,
}: {
  readonly device: LinkedDeviceRecord;
  readonly thisDeviceId: DeviceId;
  readonly onClose: () => void;
}) => {
  const { t } = useTranslation();
  const pushToast = usePushToast();
  const devices = useDevicesRepository();
  const [name, setName] = React.useState<string>(device.name);
  const [confirmingRemoval, setConfirmingRemoval] = React.useState(false);
  const trimmed = name.trim().slice(0, 255);

  const rename = async () => {
    if (trimmed === "" || trimmed === device.name) return onClose();
    try {
      await Effect.runPromise(devices.rename(device.id, trimmed));
      reportAppLog({
        tag: "devices.renamed",
        summary: "Renamed a device in the devices list",
        payload: { deviceId: device.id, name: trimmed },
      });
    } catch (error) {
      reportAppLog({
        tag: "devices.renameFailed",
        summary: "Renaming a device in the devices list failed",
        payload: {
          deviceId: device.id,
          error: getUnknownErrorMessage(error, "unknown"),
        },
      });
      pushToast(t("devicesRenameFailed"));
    }
    onClose();
  };

  const remove = async () => {
    try {
      await Effect.runPromise(devices.remove(device.id, thisDeviceId));
      reportAppLog({
        tag: "devices.removed",
        summary:
          "Removed a device; it signs out and erases its data once it syncs",
        payload: { deviceId: device.id, app: device.app },
      });
      pushToast(t("devicesRemoved"));
    } catch (error) {
      reportAppLog({
        tag: "devices.removeFailed",
        summary: "Removing a device from the devices list failed",
        payload: {
          deviceId: device.id,
          error: getUnknownErrorMessage(error, "unknown"),
        },
      });
      pushToast(t("devicesRemoveFailed"));
    }
    onClose();
  };

  if (confirmingRemoval)
    return (
      <Dialog
        open
        onOpenChange={(open) => (open ? undefined : onClose())}
        title={t("devicesRemoveConfirmTitle").replace("{name}", device.name)}
        description={t("devicesRemoveConfirmBody")}
        testID="remove-device-dialog"
        actions={
          <Stack gap="$sm">
            <Button
              variant="danger"
              icon="Trash2"
              testID="remove-device-confirm"
              onPress={() => void remove()}
            >
              {t("devicesRemove")}
            </Button>
            <Button variant="secondary" onPress={onClose}>
              {t("cancel")}
            </Button>
          </Stack>
        }
      />
    );

  return (
    <Dialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={device.name}
      description={describe(device)}
      closeLabel={t("close")}
      testID="device-dialog"
      actions={
        <Stack gap="$sm">
          <Button
            icon="PencilLine"
            testID="rename-device"
            disabled={trimmed === ""}
            onPress={() => void rename()}
          >
            {t("devicesRename")}
          </Button>
          {device.id === thisDeviceId ? null : (
            <Button
              variant="secondary"
              icon="Trash2"
              testID="remove-device"
              onPress={() => setConfirmingRemoval(true)}
            >
              {t("devicesRemove")}
            </Button>
          )}
        </Stack>
      }
    >
      <TextField
        testID="device-name"
        label={t("devicesNameLabel")}
        value={name}
        onChangeText={setName}
        maxLength={255}
      />
    </Dialog>
  );
};

/** Every device of the recovery seed, in every app: rename, remove, add one by QR code. */
export function DevicesPage(): React.ReactElement {
  const { t } = useTranslation();
  const devices = useDeviceRecords();
  const seed = useSeedMnemonic();
  const thisDeviceId = React.useMemo(() => readThisDevice().id, []);
  const [open, setOpen] = React.useState<DeviceId | "add" | null>(null);
  const sorted = sortDevices(devices, thisDeviceId);
  const selected =
    open === null || open === "add"
      ? null
      : (devices.find((device) => device.id === open) ?? null);

  return (
    <Stack gap="$lg">
      <Text color="$colorMuted">{t("devicesIntro")}</Text>
      <Card paddingVertical="$sm" gap="$none">
        {sorted.map((device) => (
          <ListRow
            key={device.id}
            testID={`device-${device.id}`}
            icon={device.deviceType === "desktop" ? "Monitor" : "Smartphone"}
            title={device.name}
            description={describe(device)}
            trailing={
              device.id === thisDeviceId ? (
                <Pill size="sm" label={t("devicesThisDevice")} />
              ) : undefined
            }
            onPress={() => setOpen(device.id)}
          />
        ))}
      </Card>
      <Button
        icon="QrCode"
        testID="add-device"
        disabled={seed === null}
        onPress={() => setOpen("add")}
      >
        {t("devicesAdd")}
      </Button>
      {open === "add" ? (
        <AddDeviceDialog onClose={() => setOpen(null)} />
      ) : null}
      {selected === null ? null : (
        <DeviceDialog
          device={selected}
          thisDeviceId={thisDeviceId}
          onClose={() => setOpen(null)}
        />
      )}
    </Stack>
  );
}
