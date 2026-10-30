import {
  Button,
  IconButton,
  Image,
  Row,
  space,
  Stack,
  Text,
  TopBar,
} from "@linky-fit/ui";
import { useEffect, useState } from "react";
import { copy } from "../copy";
import { navigateTo } from "../platform/hashRoute";
import { useDevice } from "../services/react";
import { LanguageDialog } from "./LanguageDialog";
import { Page } from "./Page";

/** The logo tile is 384 px with corners at 0.28 of its width. */
const LOGO_SIZE = 112;
const LOGO_RADIUS = Math.round(LOGO_SIZE * 0.28);

export function WelcomeScreen() {
  const device = useDevice();
  const [choosingLanguage, setChoosingLanguage] = useState(false);
  // The recovery seed takes a moment to derive; by the time the form is filled it is ready.
  useEffect(() => device.prepareAccount(), [device]);
  return (
    <Page testID="welcome-screen">
      {/* Pinned to the top of the content column, spanning its gutter, like Linky's welcome. */}
      <Stack marginTop={-space.lg} marginHorizontal={-space.xl}>
        <TopBar
          trailing={
            <IconButton
              testID="welcome-language"
              icon="Languages"
              size="sm"
              accessibilityLabel={copy.settings.language}
              tooltip={copy.settings.language}
              onPress={() => setChoosingLanguage(true)}
            />
          }
        />
      </Stack>
      <Stack flexGrow={1} justifyContent="center" gap="$xl">
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
        <Stack gap="$sm">
          <Button
            testID="welcome-setup"
            icon="Store"
            minHeight="$controlLg"
            onPress={() => navigateTo("setup")}
          >
            {copy.welcome.setupShop}
          </Button>
          <Button
            testID="welcome-restore"
            variant="secondary"
            icon="KeyRound"
            minHeight="$controlLg"
            onPress={() => navigateTo("restore")}
          >
            {copy.welcome.restore}
          </Button>
        </Stack>
      </Stack>
      <LanguageDialog
        open={choosingLanguage}
        onClose={() => setChoosingLanguage(false)}
      />
    </Page>
  );
}
