import { Button, Row, Stack, Text, useMedia } from "@linky-fit/ui";
import { siteConfig } from "../config";
import { copy } from "../copy";
import { Logo, Wordmark } from "./parts";
import { sectionIds } from "./sectionIds";

const nav = copy.nav;

const links = [
  { id: sectionIds.benefits, label: nav.benefits },
  { id: sectionIds.howItWorks, label: nav.howItWorks },
  { id: sectionIds.tips, label: nav.tips },
  { id: sectionIds.wallet, label: nav.wallet },
  { id: sectionIds.faq, label: nav.faq },
];

function NavLink({ href, label }: { href: string; label: string }) {
  return (
    <Text
      render={<a href={href} />}
      variant="label"
      color="$colorMuted"
      hoverStyle={{ color: "$colorStrong" }}
    >
      {label}
    </Text>
  );
}

/** The sticky, translucent bar: the brand, the sections on wide screens and the app. */
export function SiteHeader() {
  const { wide } = useMedia();
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
        {wide ? (
          <Row render="nav" aria-label={nav.label} gap="$xxl">
            {links.map((link) => (
              <NavLink key={link.id} href={`#${link.id}`} label={link.label} />
            ))}
          </Row>
        ) : null}
        <Button
          render={<a href={siteConfig.webAppUrl} />}
          role="link"
          size="sm"
        >
          {nav.openApp}
        </Button>
      </Row>
    </Stack>
  );
}
