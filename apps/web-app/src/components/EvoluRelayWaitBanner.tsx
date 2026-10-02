import React from "react";
import { useAccountHydrated } from "../app/hooks/useLinksync";
import { useDeferredOnlineReady } from "../hooks/useDeferredOnlineReady";
import type { Translate } from "../i18n";

/** A normal launch hydrates well within this, so the banner does not flash. */
const SHOW_AFTER_MS = 3_000;

interface EvoluRelayWaitBannerProps {
  t: Translate;
}

/** Says why no messages arrive: Nostr waits until an Evolu relay has delivered the account's data. */
export const EvoluRelayWaitBanner: React.FC<EvoluRelayWaitBannerProps> = ({
  t,
}) => {
  const due = useDeferredOnlineReady({ delayMs: SHOW_AFTER_MS });
  const hydrated = useAccountHydrated();
  if (!due || hydrated) return null;

  return (
    <div className="evolu-relay-wait-banner" role="status" aria-live="polite">
      <span className="btn-spinner" aria-hidden="true" />
      <span>{t("evoluRelayWaiting")}</span>
    </div>
  );
};
