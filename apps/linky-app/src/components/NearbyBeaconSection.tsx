import {
  Button,
  Dialog,
  Icon,
  ListRow,
  Row,
  Stack,
  Switch,
  Text,
  type IconName,
} from "@linky-fit/ui";
import React from "react";
import { useBeacon, type UseBeacon } from "../app/hooks/useBeacon";
import type { I18nKey, Translate } from "../i18n";
import { getPlatformTarget } from "../platform/runtime";

const beaconStatusText = (
  { enabled, permission, status, keyCount }: UseBeacon,
  t: Translate,
): string => {
  if (!enabled) return t("beaconStatusOff");
  if (permission !== "granted") return t("beaconStatusPermissionNeeded");
  if (!status.bluetoothOn || status.error === "bluetooth_unavailable")
    return t("beaconStatusBluetoothOff");
  if (!status.running || status.error?.startsWith("advertise_failed_"))
    return t("beaconStatusNotBroadcasting");
  return keyCount === 1
    ? t("beaconStatusBroadcastingOne")
    : t("beaconStatusBroadcastingOther").replace("{count}", String(keyCount));
};

const beaconIntroPoints = (): ReadonlyArray<{
  icon: IconName;
  key: I18nKey;
}> => [
  { icon: "Users", key: "beaconIntroContacts" },
  { icon: "ShieldCheck", key: "beaconIntroNpub" },
  {
    icon: "Bell",
    key:
      getPlatformTarget() === "ios"
        ? "beaconIntroBluetoothIos"
        : "beaconIntroBluetooth",
  },
];

function BeaconIntro({
  open,
  onClose,
  onTurnOn,
  t,
}: {
  open: boolean;
  onClose: () => void;
  onTurnOn: () => void;
  t: Translate;
}): React.ReactElement {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t("beacon")}
      closeLabel={t("close")}
      fullScreen
      actions={
        <>
          <Button icon="Radio" onPress={onTurnOn}>
            {t("beaconTurnOn")}
          </Button>
          <Button variant="ghost" onPress={onClose}>
            {t("beaconNotNow")}
          </Button>
        </>
      }
    >
      <Stack flex={1} justifyContent="center" gap="$xxl">
        <Stack
          alignSelf="center"
          padding="$xl"
          borderRadius="$pill"
          backgroundColor="$accentSoft"
        >
          <Icon name="Radio" size="xl" color="$accentText" />
        </Stack>
        <Stack gap="$lg">
          {beaconIntroPoints().map(({ icon, key }) => (
            <Row key={key} gap="$md" alignItems="flex-start">
              <Icon name={icon} color="$accentText" />
              <Text flex={1} color="$colorSubtle">
                {t(key)}
              </Text>
            </Row>
          ))}
        </Stack>
      </Stack>
    </Dialog>
  );
}

// The offer to turn the beacon on shows once per app session, not on every visit.
let beaconOffered = false;

/**
 * The beacon switch; the intro shows before the first switch-on, and with
 * `offerOnMount` also once per session when the page opens with the beacon off.
 */
export function NearbyBeaconSection({
  offerOnMount = false,
  t,
}: {
  offerOnMount?: boolean;
  t: Translate;
}): React.ReactElement {
  const beacon = useBeacon();
  const [introOpen, setIntroOpen] = React.useState(false);

  React.useEffect(() => {
    if (!offerOnMount || beacon.enabled || beaconOffered) return;
    beaconOffered = true;
    setIntroOpen(true);
    // Only the first render decides; the switch itself reacts to later changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setEnabled = (enabled: boolean) => {
    if (enabled && !beacon.introSeen) {
      setIntroOpen(true);
      return;
    }
    void beacon.setEnabled(enabled);
  };
  const turnOn = () => {
    setIntroOpen(false);
    beacon.markIntroSeen();
    void beacon.setEnabled(true);
  };

  return (
    <Stack gap="$sm">
      <Text variant="title" role="heading">
        {t("nearby")}
      </Text>
      <Stack data-guide="beacon-switch">
        <ListRow
          icon="Radio"
          title={t("beacon")}
          description={beaconStatusText(beacon, t)}
          trailing={
            <Switch
              accessibilityLabel={t("beacon")}
              value={beacon.enabled}
              onValueChange={setEnabled}
            />
          }
        />
      </Stack>
      <Text variant="label" fontWeight="$regular" color="$colorMuted">
        {t("beaconMutualOnly")}
      </Text>
      <BeaconIntro
        open={introOpen}
        onClose={() => setIntroOpen(false)}
        onTurnOn={turnOn}
        t={t}
      />
    </Stack>
  );
}
