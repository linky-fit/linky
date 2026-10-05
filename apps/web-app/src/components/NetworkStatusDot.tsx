import { Pressable, StatusDot } from "@linky-fit/ui";
import type { Tone } from "@linky-fit/ui";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useNetworkStatus } from "../app/hooks/useNetworkStatus";
import type { NetworkStatus } from "../app/hooks/useNetworkStatus";
import type { I18nKey } from "../i18n";
import { navigateTo } from "../hooks/useRouting";

const networkDot = {
  synced: { tone: "accent", labelKey: "networkSynced" },
  syncing: { tone: "warning", labelKey: "networkSyncing" },
  offline: { tone: "danger", labelKey: "networkOffline" },
} as const satisfies Record<NetworkStatus, { tone: Tone; labelKey: I18nKey }>;

/** Shows whether Linky reaches its relays and has received their data; opens the network settings. */
export function NetworkStatusDot(): React.ReactElement {
  const { t } = useAppShellCore();
  const { tone, labelKey } = networkDot[useNetworkStatus()];
  return (
    <Pressable
      padding="$sm"
      borderRadius="$pill"
      aria-label={t(labelKey)}
      onPress={() => navigateTo({ route: "relays" })}
    >
      <StatusDot tone={tone} accessibilityLabel={t(labelKey)} />
    </Pressable>
  );
}
