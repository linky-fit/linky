import { Button, Row, Stack } from "@linky-fit/ui";
import { siteConfig } from "../config";
import { copy } from "../copy";
import { Logo, Wordmark } from "./parts";

const nav = copy.nav;

/** The sticky, translucent bar: the brand and the app. */
export function SiteHeader() {
  return (
    <Stack
      render="header"
      position="sticky"
      top="$none"
      zIndex="$sticky"
      gap="$none"
      backdropFilter="blur(16px)"
    >
      <Stack
        position="absolute"
        inset={0}
        backgroundColor="$background"
        opacity={0.82}
      />
      <Row
        position="relative"
        width="100%"
        maxWidth="$appWidth"
        alignSelf="center"
        justifyContent="space-between"
        paddingHorizontal="$xl"
        paddingVertical="$md"
      >
        <Row render={<a href="#top" aria-label={nav.home} />} gap="$sm">
          <Logo size={36} />
          <Wordmark />
        </Row>
        <Button render={<a href={siteConfig.webAppUrl} />} role="link">
          {nav.openApp}
        </Button>
      </Row>
    </Stack>
  );
}
