import type { PairingOffer, PairingOfferState } from "@linky-fit/linkstr";
import type { DeviceId, LinkedDeviceRecord } from "@linky-fit/linksync";
import { useLiveValue } from "@linky-fit/linksync/react";
import {
  Button,
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
import { useEffect, useRef, useState } from "react";
import { copy } from "../copy";
import { loadDevicePairing, pairingRelays } from "../platform/devicePairing";
import { deviceAppName } from "../services/devices";
import { useAppServices } from "../services/react";

const describe = (device: LinkedDeviceRecord): string =>
  [deviceAppName(device.app), device.browserName, device.osName]
    .filter((part) => part !== null && part !== "")
    .join(" · ");

const NO_DEVICES: ReadonlyArray<LinkedDeviceRecord> = [];

type View =
  | { readonly kind: "list" }
  | { readonly kind: "device"; readonly id: DeviceId }
  | { readonly kind: "remove"; readonly id: DeviceId }
  | { readonly kind: "add" };

interface ShopShown {
  readonly name: string | null;
  readonly picture: string | null;
}

/** Shows the pairing QR code, then takes the code the new device shows; `onAdded` once the device has the seed. */
function AddDevice({
  shop,
  onAdded,
}: {
  readonly shop: ShopShown;
  readonly onAdded: () => void;
}) {
  const { devices } = useAppServices();
  const [state, setState] = useState<PairingOfferState | null>(null);
  const [code, setCode] = useState("");
  const [attempt, setAttempt] = useState(0);
  const session = useRef<PairingOffer | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadDevicePairing(), devices.pairingPayload(shop)]).then(
      ([pairing, payload]) => {
        if (cancelled) return;
        session.current = pairing.offer({
          payload,
          relays: pairingRelays(),
          onState: (next) => {
            if (next.phase === "done") onAdded();
            else setState(next);
          },
        });
      },
      () => {
        if (!cancelled) setState({ phase: "failed", reason: "network" });
      },
    );
    return () => {
      cancelled = true;
      session.current?.cancel();
      session.current = null;
    };
    // A new attempt starts a new session; the shop stays for the dialog's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, devices]);

  const restart = () => {
    setState(null);
    setCode("");
    setAttempt((current) => current + 1);
  };

  if (state === null || state.phase === "sending")
    return (
      <Stack alignItems="center" gap="$sm" paddingVertical="$lg">
        <Spinner />
        {state?.phase === "sending" ? (
          <Text color="$colorMuted">{copy.devices.sending}</Text>
        ) : null}
      </Stack>
    );
  if (state.phase === "waiting")
    return (
      <Stack gap="$lg">
        <QRCode
          value={state.invite}
          accessibilityLabel={copy.devices.add}
          testID="add-device-qr"
        />
        <Text color="$colorMuted" textAlign="center">
          {copy.devices.scanHint}
        </Text>
        <Notice tone="warning" title={copy.devices.warning} />
      </Stack>
    );
  if (state.phase === "locked")
    return (
      <Stack gap="$lg">
        <CodeField
          testID="add-device-code"
          label={copy.devices.code}
          hint={copy.devices.codeHint}
          error={
            state.mismatch
              ? copy.devices.codeMismatch(state.attemptsLeft)
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
        <Notice tone="warning" title={copy.devices.warning} />
      </Stack>
    );
  return (
    <Stack gap="$lg">
      <Notice
        tone={state.phase === "expired" ? "info" : "danger"}
        title={
          state.phase === "expired" ||
          (state.phase === "failed" && state.reason === "cancelled")
            ? copy.devices.expired
            : state.phase === "failed" && state.reason === "conflict"
              ? copy.devices.conflict
              : copy.devices.failed
        }
      />
      <Button icon="QrCode" onPress={restart}>
        {copy.devices.newCode}
      </Button>
    </Stack>
  );
}

/** One device: rename it, or remove another one, which signs it out. */
function DeviceDetail({
  device,
  isThisDevice,
  onRemove,
  onDone,
}: {
  readonly device: LinkedDeviceRecord;
  readonly isThisDevice: boolean;
  readonly onRemove: () => void;
  readonly onDone: () => void;
}) {
  const { devices } = useAppServices();
  const [name, setName] = useState<string>(device.name);
  const trimmed = name.trim();
  return (
    <Stack gap="$lg">
      <Text color="$colorMuted">{describe(device)}</Text>
      <TextField
        testID="device-name"
        label={copy.devices.name}
        value={name}
        onChangeText={setName}
        maxLength={255}
      />
      <Button
        icon="PencilLine"
        testID="rename-device"
        disabled={trimmed === ""}
        onPress={() => {
          if (trimmed !== device.name) void devices.rename(device.id, trimmed);
          onDone();
        }}
      >
        {copy.devices.rename}
      </Button>
      {isThisDevice ? null : (
        <Button
          variant="secondary"
          icon="Trash2"
          testID="remove-device"
          onPress={onRemove}
        >
          {copy.devices.remove}
        </Button>
      )}
    </Stack>
  );
}

/** Every device of the recovery seed, in every app: rename, remove, add one by QR code. */
export function DevicesDialog({
  shop,
  onClose,
}: {
  readonly shop: ShopShown;
  readonly onClose: () => void;
}) {
  const { devices } = useAppServices();
  const records = useLiveValue(devices.live, NO_DEVICES);
  const [view, setView] = useState<View>({ kind: "list" });
  const [notice, setNotice] = useState<"added" | "removed" | null>(null);
  const thisId = devices.thisDeviceId;
  const sorted = [...records].sort(
    (a, b) =>
      Number(b.id === thisId) - Number(a.id === thisId) ||
      a.app.localeCompare(b.app) ||
      a.name.localeCompare(b.name),
  );
  const selected =
    view.kind === "device" || view.kind === "remove"
      ? (records.find((device) => device.id === view.id) ?? null)
      : null;
  const back = () => setView({ kind: "list" });

  const title =
    view.kind === "add"
      ? copy.devices.add
      : view.kind === "remove" && selected !== null
        ? copy.devices.removeConfirmTitle(selected.name)
        : view.kind === "device" && selected !== null
          ? selected.name
          : copy.devices.title;

  return (
    <Dialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={title}
      closeLabel={copy.close}
      testID="devices-dialog"
    >
      {view.kind === "list" || selected === null ? (
        view.kind === "add" ? (
          <AddDevice
            shop={shop}
            onAdded={() => {
              setNotice("added");
              back();
            }}
          />
        ) : (
          <Stack gap="$lg">
            <Text color="$colorMuted">{copy.devices.description}</Text>
            {notice === null ? null : (
              <Notice
                tone={notice === "added" ? "accent" : "info"}
                title={
                  notice === "added" ? copy.devices.done : copy.devices.removed
                }
              />
            )}
            <Stack gap="$none">
              {sorted.map((device) => (
                <ListRow
                  key={device.id}
                  testID={`device-${device.id}`}
                  icon={
                    device.deviceType === "desktop" ? "Monitor" : "Smartphone"
                  }
                  title={device.name}
                  description={describe(device)}
                  trailing={
                    device.id === thisId ? (
                      <Pill size="sm" label={copy.devices.thisDevice} />
                    ) : undefined
                  }
                  onPress={() => setView({ kind: "device", id: device.id })}
                />
              ))}
            </Stack>
            <Button
              icon="QrCode"
              testID="add-device"
              onPress={() => setView({ kind: "add" })}
            >
              {copy.devices.add}
            </Button>
          </Stack>
        )
      ) : view.kind === "remove" ? (
        <Stack gap="$lg">
          <Text color="$colorMuted">
            {copy.devices.removeConfirmDescription}
          </Text>
          <Button
            variant="danger"
            icon="Trash2"
            testID="remove-device-confirm"
            onPress={() => {
              void devices.remove(selected.id);
              setNotice("removed");
              back();
            }}
          >
            {copy.devices.remove}
          </Button>
          <Button variant="secondary" onPress={back}>
            {copy.cancel}
          </Button>
        </Stack>
      ) : (
        <DeviceDetail
          device={selected}
          isThisDevice={selected.id === thisId}
          onRemove={() => setView({ kind: "remove", id: selected.id })}
          onDone={back}
        />
      )}
    </Dialog>
  );
}
