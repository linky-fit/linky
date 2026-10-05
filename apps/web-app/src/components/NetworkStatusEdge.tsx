import { EdgeStatus, Stack } from "@linky-fit/ui";
import type { EdgeStatusItem, Tone } from "@linky-fit/ui";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useNetworkStatus } from "../app/hooks/useNetworkStatus";
import type {
  EvoluPhase,
  NetworkReport,
  NetworkStatus,
  NostrPhase,
} from "../app/hooks/useNetworkStatus";
import type { I18nKey, Translate } from "../i18n";

const summary = {
  synced: { tone: "accent", labelKey: "networkSynced" },
  syncing: { tone: "warning", labelKey: "networkSyncing" },
  offline: { tone: "danger", labelKey: "networkOffline" },
} as const satisfies Record<NetworkStatus, { tone: Tone; labelKey: I18nKey }>;

interface PhaseLine {
  tone: Tone;
  labelKey: I18nKey;
  busy?: true;
}

const evoluLines = {
  unconfigured: { tone: "danger", labelKey: "networkEvoluUnconfigured" },
  unreachable: { tone: "danger", labelKey: "networkEvoluUnreachable" },
  connecting: {
    tone: "warning",
    labelKey: "networkEvoluConnecting",
    busy: true,
  },
  syncing: { tone: "warning", labelKey: "networkEvoluSyncing", busy: true },
  synced: { tone: "accent", labelKey: "networkEvoluSynced" },
} as const satisfies Record<EvoluPhase, PhaseLine>;

const nostrLines = {
  unconfigured: { tone: "danger", labelKey: "networkNostrUnconfigured" },
  unreachable: { tone: "danger", labelKey: "networkNostrUnreachable" },
  connecting: {
    tone: "warning",
    labelKey: "networkNostrConnecting",
    busy: true,
  },
  scanning: { tone: "warning", labelKey: "networkNostrScanning", busy: true },
  synced: { tone: "accent", labelKey: "networkNostrSynced" },
} as const satisfies Record<NostrPhase, PhaseLine>;

const lineOf = (
  t: Translate,
  { labelKey, ...line }: PhaseLine,
  { connected, total }: { connected: number; total: number },
): EdgeStatusItem => ({
  ...line,
  label: t(labelKey)
    .replace("{connected}", String(connected))
    .replace("{total}", String(total)),
});

const itemsOf = (t: Translate, report: NetworkReport): EdgeStatusItem[] =>
  report.online
    ? [
        lineOf(t, nostrLines[report.nostr.phase], report.nostr),
        lineOf(t, evoluLines[report.evolu.phase], report.evolu),
      ]
    : [{ tone: "danger", label: t("networkNoInternet") }];

/** The network state on the window's bottom-left edge, with what each relay side is doing on hover or press. */
export function NetworkStatusEdge(): React.ReactElement {
  const { t } = useAppShellCore();
  const report = useNetworkStatus();
  const { tone, labelKey } = summary[report.status];
  return (
    <Stack
      position="absolute"
      left={0}
      bottom={0}
      zIndex="$overlay"
      data-safe-area="bottom"
    >
      <EdgeStatus tone={tone} label={t(labelKey)} items={itemsOf(t, report)} />
    </Stack>
  );
}
