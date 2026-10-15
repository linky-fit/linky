import { Stack, StatusLine } from "@linky-fit/ui";
import React from "react";
import { useAccountHydrated } from "../app/hooks/useLinksync";
import { useDeferredOnlineReady } from "../hooks/useDeferredOnlineReady";
import type { Translate } from "../i18n";

/** A normal launch hydrates well within this, so the banner does not flash. */
const SHOW_AFTER_MS = 3_000;

interface EvoluRelayWaitBannerProps {
  /** Sits inside the desktop layout's padding instead of spanning the window. */
  inset: boolean;
  t: Translate;
}

/** Says why no messages arrive: Nostr waits until an Evolu relay has delivered the account's data. */
export const EvoluRelayWaitBanner: React.FC<EvoluRelayWaitBannerProps> = ({
  inset,
  t,
}) => {
  const due = useDeferredOnlineReady({ delayMs: SHOW_AFTER_MS });
  const hydrated = useAccountHydrated();
  if (!due || hydrated) return null;

  const line = (
    <StatusLine busy rounded={inset} label={t("evoluRelayWaiting")} />
  );
  return inset ? (
    <Stack paddingHorizontal="$lg" paddingTop="$lg">
      {line}
    </Stack>
  ) : (
    line
  );
};
