import { Button, Icon, Pill, Row, Stack, Text, useMedia } from "@linky-fit/ui";
import { siteConfig } from "../config";
import { copy } from "../copy";
import { DemoApp } from "../demo/DemoApp";
import { Glow } from "./parts";
import { sectionIds } from "./sectionIds";

const hero = copy.hero;

function DemoHint() {
  const { wide } = useMedia();
  return (
    <Row
      gap="$sm"
      flexWrap="wrap"
      justifyContent={wide ? "flex-start" : "center"}
    >
      <Pill
        label={hero.demoLabel}
        leading={<Icon name="Play" size="sm" color="$accentText" />}
      />
      <Text variant="label" color="$colorMuted">
        {hero.demoHint}
      </Text>
    </Row>
  );
}

export function Hero() {
  const { wide } = useMedia();
  const Columns = wide ? Row : Stack;
  const titleVariant = wide ? "headline" : "display";
  return (
    <Columns
      gap={wide ? "$huge" : "$xxxl"}
      alignItems="center"
      paddingTop={wide ? "$huge" : "$xxl"}
      paddingBottom="$huge"
    >
      <Stack
        flex={wide ? 1 : undefined}
        flexBasis={wide ? 0 : undefined}
        width="100%"
        gap="$xxl"
        transition="slow"
        enterStyle={{ opacity: 0, y: 24 }}
      >
        <Pill
          label={hero.eyebrow}
          leading={<Icon name="Smartphone" size="sm" color="$accentText" />}
        />
        <Text
          variant={titleVariant}
          color="$colorStrong"
          role="heading"
          aria-level={1}
        >
          {hero.titleBefore}
          <Text variant={titleVariant} color="$accent">
            {hero.titleAccent}
          </Text>
        </Text>
        <Text
          variant="title"
          fontWeight="$regular"
          color="$colorMuted"
          maxWidth="$sheetWidth"
        >
          {hero.subtitle}
        </Text>
        <Columns gap="$sm" alignItems="stretch">
          <Button
            render={<a href={siteConfig.webAppUrl} />}
            role="link"
            icon="Smartphone"
            minHeight="$controlLg"
            paddingHorizontal="$xxl"
          >
            {hero.primaryCta}
          </Button>
          <Button
            render={<a href={`#${sectionIds.howItWorks}`} />}
            role="link"
            variant="secondary"
            minHeight="$controlLg"
            paddingHorizontal="$xxl"
          >
            {hero.secondaryCta}
          </Button>
        </Columns>
        <Row gap="$xl" flexWrap="wrap">
          {hero.methods.map((method) => (
            <Row key={method.label} gap="$xs">
              <Icon name={method.icon} size="sm" color="$colorMuted" />
              <Text variant="label" color="$colorMuted">
                {method.label}
              </Text>
            </Row>
          ))}
        </Row>
        {wide ? <DemoHint /> : null}
      </Stack>
      <Stack
        flex={wide ? 1 : undefined}
        flexBasis={wide ? 0 : undefined}
        width="100%"
        position="relative"
        alignItems="center"
        gap="$lg"
        transition={["slow", { delay: 150 }]}
        enterStyle={{ opacity: 0, y: 40 }}
      >
        <Glow />
        {wide ? null : <DemoHint />}
        <DemoApp
          start="terminal"
          accessibilityLabel={copy.demo.labels.terminal}
          maxWidth={wide ? 340 : 360}
        />
      </Stack>
    </Columns>
  );
}
