import { Button, Card, Row, Stack, Text, useMedia } from "@linky-fit/ui";
import { siteConfig } from "../config";
import { useCopy } from "../locale";
import { Glow, Logo, Reveal, Wordmark } from "./parts";

export function Closing() {
  const copy = useCopy();
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
            icon="Play"
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

/** Who took the merchants' photos, as their Creative Commons licences ask. */
function PhotoCredits() {
  const copy = useCopy();
  return (
    <Row
      width="100%"
      maxWidth="$appWidth"
      alignSelf="center"
      flexWrap="wrap"
      gap="$xs"
      paddingHorizontal="$xl"
      paddingBottom="$xl"
    >
      <Text variant="caption" color="$colorMuted">
        {copy.stories.photos}:
      </Text>
      {copy.stories.credits.map((credit, index) => (
        <Text
          key={credit.url}
          render={
            <a href={credit.url} target="_blank" rel="noopener noreferrer" />
          }
          variant="caption"
          color="$colorMuted"
          hoverStyle={{ color: "$colorStrong" }}
        >
          {credit.author} ({credit.license})
          {index < copy.stories.credits.length - 1 ? "," : ""}
        </Text>
      ))}
    </Row>
  );
}

export function SiteFooter() {
  const copy = useCopy();
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
      <PhotoCredits />
    </Stack>
  );
}
