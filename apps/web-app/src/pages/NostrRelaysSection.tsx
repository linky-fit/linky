import { EmptyState, ListRow, Section } from "@linky-fit/ui";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useRelaySettingsContext } from "../app/context/SystemSettingsContexts";
import { relayDotState, useRelayHealth } from "../app/hooks/useRelayHealth";
import { NostrRelayRow } from "../components/NostrRelayRow";
import { navigateTo } from "../hooks/useRouting";

export function NostrRelaysSection(): React.ReactElement {
  const { isRecommendedRelay, relayUrls } = useRelaySettingsContext();
  const relayHealth = useRelayHealth();
  const { t } = useAppShellCore();
  return (
    <Section title="Nostr">
      {relayUrls.length === 0 ? (
        <EmptyState title={t("nostrRelaysEmpty")} />
      ) : (
        relayUrls.map((url) => {
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
        })
      )}
      <ListRow
        icon="Plus"
        title={t("addRelay")}
        onPress={() => navigateTo({ route: "nostrRelayNew" })}
      />
    </Section>
  );
}
