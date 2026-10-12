import { Button, ListRow, Notice, Stack, StatusDot, Text } from "@linky-fit/ui";
import { connectionStatus } from "../utils/connectionStatus";
import React from "react";
import { useTranslation } from "../app/hooks/shell";
import { useRelaySettings } from "../app/hooks/settings/useRelaySettings";
import { relayDotState, useRelayHealth } from "../app/hooks/useRelayHealth";
import { formatTimeAgo } from "../utils/formatting";
export function NostrRelayPage(): React.ReactElement {
  const {
    isRecommendedRelay,
    pendingRelayDeleteUrl,
    requestDeleteSelectedRelay,
    selectedRelayUrl,
  } = useRelaySettings();
  const relayHealth = useRelayHealth();
  const { lang, t } = useTranslation();
  if (!selectedRelayUrl) {
    return <Notice tone="danger" title={t("errorPrefix")} />;
  }
  const health = relayHealth.get(selectedRelayUrl);
  const dotState = relayDotState(health);
  const stateLabel = t(connectionStatus[dotState].labelKey);
  const lastPublish = health?.lastPublish ?? null;
  return (
    <Stack gap="$lg">
      <ListRow
        title={selectedRelayUrl}
        trailing={
          <StatusDot
            tone={connectionStatus[dotState].tone}
            accessibilityLabel={stateLabel}
          />
        }
      />

      <ListRow
        title={t("relayStatusLabel")}
        value={stateLabel}
        testID="relayStatusLabel"
      />

      {health?.state === "unreachable" && health.detail ? (
        <Notice tone="danger" title={health.detail} />
      ) : null}

      {lastPublish ? (
        <ListRow
          title={t("relayLastPublish")}
          value={`${
            lastPublish.accepted
              ? t("relayPublishAccepted")
              : t("relayPublishRejected")
          } · ${formatTimeAgo(lastPublish.at, lang)}`}
          testID="relayLastPublish"
        />
      ) : null}

      {isRecommendedRelay(selectedRelayUrl) ? (
        <Text variant="label" color="$colorMuted">
          {t("relayRecommendedNote")}
        </Text>
      ) : (
        <Button
          onPress={requestDeleteSelectedRelay}
          variant={
            pendingRelayDeleteUrl === selectedRelayUrl ? "danger" : "secondary"
          }
        >
          {t("delete")}
        </Button>
      )}
    </Stack>
  );
}
