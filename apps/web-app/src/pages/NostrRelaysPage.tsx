import { EmptyState, Stack } from "@linky-fit/ui";
import React from "react";
import { useTranslation } from "../app/hooks/shell";
import { useRelaySettings } from "../app/hooks/settings/useRelaySettings";
import { relayDotState, useRelayHealth } from "../app/hooks/useRelayHealth";
import { NostrRelayRow } from "../components/NostrRelayRow";
export function NostrRelaysPage(): React.ReactElement {
  const { isRecommendedRelay, relayUrls } = useRelaySettings();
  const relayHealth = useRelayHealth();
  const { t } = useTranslation();
  return (
    <Stack gap="$lg">
      {relayUrls.length === 0 ? (
        <EmptyState title={t("nostrRelaysEmpty")} />
      ) : (
        <Stack>
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
        </Stack>
      )}
    </Stack>
  );
}
