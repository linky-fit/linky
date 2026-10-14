import { Button, Card, Row, Stack, Text, useMedia } from "@linky-fit/ui";
import { siteConfig } from "../config";
import { copy } from "../copy";
import { Glow, Logo, Reveal, Wordmark } from "./parts";

export function Closing() {
  const { wide } = useMedia();
  return (
    <Stack render="section" paddingVertical="$huge">
      <Reveal>
        <Card
          position="relative"
          overflow="hidden"
          alignItems="center"
          gap="$xxl"
          paddingVertical="$huge"
          paddingHorizontal="$xxl"
          borderRadius="$sheet"
        >
          <Glow />
          <Logo size={96} />
          <Stack gap="$md" alignItems="center" maxWidth="$contentWidth">
            <Text
              variant={wide ? "amount" : "display"}
              color="$colorStrong"
              textAlign="center"
              role="heading"
              aria-level={2}
            >
              {copy.closing.title}
            </Text>
            <Text
              variant="title"
              fontWeight="$regular"
              color="$colorMuted"
              textAlign="center"
            >
              {copy.closing.body}
            </Text>
          </Stack>
          <Button
            render={<a href={siteConfig.webAppUrl} />}
            role="link"
            icon="Smartphone"
            minHeight="$controlLg"
            paddingHorizontal="$xxl"
          >
            {copy.hero.primaryCta}
          </Button>
        </Card>
      </Reveal>
    </Stack>
  );
}

function FooterLink({ href, label }: { href: string; label: string }) {
  return (
    <Text
      render={<a href={href} target="_blank" rel="noopener noreferrer" />}
      variant="label"
      color="$colorMuted"
      hoverStyle={{ color: "$colorStrong" }}
    >
      {label}
    </Text>
  );
}

export function SiteFooter() {
  return (
    <Stack render="footer" gap="$none" backgroundColor="$surface">
      <Row
        width="100%"
        maxWidth="$appWidth"
        alignSelf="center"
        justifyContent="space-between"
        flexWrap="wrap"
        gap="$lg"
        paddingHorizontal="$xl"
        paddingVertical="$xxl"
      >
        <Row gap="$md" flexShrink={1}>
          <Logo size={32} />
          <Stack gap="$none" flexShrink={1}>
            <Wordmark />
            <Text variant="label" color="$colorMuted" flexShrink={1}>
              {copy.footer.tagline}
            </Text>
          </Stack>
        </Row>
        <Row gap="$xl">
          <FooterLink href={siteConfig.linkyUrl} label={copy.footer.linky} />
          <FooterLink href={siteConfig.githubUrl} label={copy.footer.github} />
        </Row>
      </Row>
    </Stack>
  );
}
