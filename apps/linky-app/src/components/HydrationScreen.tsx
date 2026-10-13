import { Button, Spinner, Stack, Text } from "@linky-fit/ui";
import React from "react";
import type { Translate } from "../i18n";

/** A hydration that takes this long likely waits on an Evolu relay that does not answer. */
export const HYDRATION_ESCAPE_AFTER_MS = 30_000;

interface HydrationScreenProps {
  synced: number;
  /** `null` hides the count until the visible shards are known. */
  total: number | null;
  onOpenRelaySettings: () => void;
  t: Translate;
}

/**
 * Full-screen wait while a restored account's data arrives. The spinner is
 * animated natively, so it keeps turning while the first sync blocks the
 * JavaScript thread.
 */
export const HydrationScreen = ({
  synced,
  total,
  onOpenRelaySettings,
  t,
}: HydrationScreenProps) => {
  const [slow, setSlow] = React.useState(false);
  React.useEffect(() => {
    const timer = setTimeout(() => setSlow(true), HYDRATION_ESCAPE_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Stack
      flex={1}
      justifyContent="center"
      alignItems="center"
      gap="$xl"
      padding="$xl"
      width="100%"
      maxWidth="$sheetWidth"
      alignSelf="center"
    >
      <Spinner size="lg" accessibilityLabel={t("hydrationTitle")} />
      <Stack gap="$xs">
        <Text variant="heading" textAlign="center">
          {t("hydrationTitle")}
        </Text>
        <Text color="$colorMuted" textAlign="center">
          {t(slow ? "hydrationSlowBody" : "hydrationBody")}
        </Text>
        {total === null ? null : (
          <Text variant="caption" color="$colorMuted" textAlign="center">
            {t("hydrationProgress")
              .replace("{synced}", String(synced))
              .replace("{total}", String(total))}
          </Text>
        )}
      </Stack>
      {slow ? (
        <Button variant="secondary" onPress={onOpenRelaySettings}>
          {t("hydrationOpenRelaySettings")}
        </Button>
      ) : null}
    </Stack>
  );
};
