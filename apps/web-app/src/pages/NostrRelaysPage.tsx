import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useRelaySettingsContext } from "../app/context/SystemSettingsContexts";
import { relayDotState, useRelayHealth } from "../app/hooks/useRelayHealth";
import { NostrRelayRow } from "../components/NostrRelayRow";

export function NostrRelaysPage(): React.ReactElement {
  const { isRecommendedRelay, relayUrls } = useRelaySettingsContext();
  const relayHealth = useRelayHealth();
  const { t } = useAppShellCore();
  return (
    <section className="panel">
      {relayUrls.length === 0 ? (
        <p className="lede">{t("noContactsYet")}</p>
      ) : (
        <div>
          {relayUrls.map((url) => {
            const health = relayHealth.get(url);
            return (
              <NostrRelayRow
                key={url}
                url={url}
                state={relayDotState(health)}
                detail={health?.state === "unreachable" ? health.detail : null}
                label={isRecommendedRelay(url) ? t("relayRecommended") : null}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
