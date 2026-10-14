import { Card, Image, ListRow, Row, Stack, Text } from "@linky-fit/ui";
import { useEffect } from "react";
import { copy } from "../copy";
import { navigateTo } from "../platform/hashRoute";
import { useDevice } from "../services/react";
import { Page } from "./Page";

/** The logo tile is 384 px with corners at 0.28 of its width. */
const LOGO_SIZE = 112;
const LOGO_RADIUS = Math.round(LOGO_SIZE * 0.28);

export function WelcomeScreen() {
  const device = useDevice();
  // The recovery seed takes a moment to derive; by the time the form is filled it is ready.
  useEffect(() => device.prepareAccount(), [device]);
  return (
    <Page centered testID="welcome-screen">
      <Stack alignItems="center" gap="$lg" paddingVertical="$xl">
        <Image
          src="/logo-tile.webp"
          width={LOGO_SIZE}
          height={LOGO_SIZE}
          borderRadius={LOGO_RADIUS}
          aria-hidden
        />
        <Stack alignItems="center" gap="$sm">
          <Row gap="$none">
            <Text variant="display" color="$colorStrong">
              fazole
            </Text>
            <Text variant="display" color="$accent">
              .fit
            </Text>
          </Row>
          <Text color="$colorMuted" textAlign="center">
            {copy.appTagline}
          </Text>
        </Stack>
      </Stack>
      <Card gap="$xs" paddingVertical="$sm">
        <ListRow
          testID="welcome-setup"
          icon="Store"
          title={copy.welcome.setupShop}
          description={copy.welcome.setupShopDescription}
          onPress={() => navigateTo("setup")}
        />
        <ListRow
          testID="welcome-restore"
          icon="KeyRound"
          title={copy.welcome.restore}
          description={copy.welcome.restoreDescription}
          onPress={() => navigateTo("restore")}
        />
      </Card>
    </Page>
  );
}
