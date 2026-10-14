import { Button, Notice, Spinner, Stack, Text } from "@linky-fit/ui";
import { useEffect, useState } from "react";
import { copy } from "../copy";
import { useDevice } from "../services/react";
import { Page } from "./Page";

/** How long a restore may take before the screen suggests what could be wrong. */
const SLOW_RESTORE_MS = 20_000;

/** Waits for the restored shop to sync; the shell routes on once it arrives. */
export function RestoringScreen() {
  const device = useDevice();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_RESTORE_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    <Page centered testID="restoring-screen">
      <Stack alignItems="center" gap="$lg">
        <Spinner size="lg" />
        <Text variant="title" textAlign="center" role="heading">
          {copy.restoring.title}
        </Text>
        <Text color="$colorMuted" textAlign="center">
          {copy.restoring.description}
        </Text>
      </Stack>
      {slow ? (
        <Stack gap="$md">
          <Notice
            tone="warning"
            title={copy.restoring.slowTitle}
            description={copy.restoring.slowDescription}
          />
          <Button variant="ghost" onPress={device.resetDevice}>
            {copy.restoring.startOver}
          </Button>
        </Stack>
      ) : null}
    </Page>
  );
}
