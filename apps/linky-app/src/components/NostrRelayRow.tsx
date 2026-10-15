import { ListRow, Stack, StatusDot, Text, Pill } from "@linky-fit/ui";
import { useTranslation } from "../app/hooks/shell";
import type { RelayDotState } from "../app/hooks/useRelayHealth";
import { navigateTo } from "../hooks/useRouting";

import { connectionStatus } from "../utils/connectionStatus";

interface NostrRelayRowProps {
  detail: string | null;
  label: string | null;
  state: RelayDotState;
  url: string;
}

export function NostrRelayRow({
  detail,
  label,
  state,
  url,
}: NostrRelayRowProps) {
  const { t } = useTranslation();
  const stateLabel = t(connectionStatus[state].labelKey);
  return (
    <ListRow
      title={url}
      description={
        label || detail ? (
          <Stack gap="$xxs">
            {label ? <Pill size="sm" label={label} /> : null}
            {detail ? (
              <Text variant="caption" color="$colorMuted">
                {detail}
              </Text>
            ) : null}
          </Stack>
        ) : undefined
      }
      trailing={
        <StatusDot
          tone={connectionStatus[state].tone}
          accessibilityLabel={stateLabel}
        />
      }
      onPress={() => navigateTo({ route: "nostrRelay", id: url })}
    />
  );
}
