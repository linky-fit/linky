import { Card, Icon, Pill, Row, Stack, Text, useMedia } from "@linky-fit/ui";
import type { IconName, Tone } from "@linky-fit/ui";
import { copy } from "../copy";
import { IconTile, Reveal, SectionHeading, SiteSection } from "./parts";
import { sectionIds } from "./sectionIds";

const how = copy.how;

function MethodCard({
  icon,
  title,
  pill,
  tone,
  body,
}: {
  icon: IconName;
  title: string;
  pill: string;
  tone: Tone;
  body: string;
}) {
  const { wide } = useMedia();
  return (
    <Card
      flex={wide ? 1 : undefined}
      flexBasis={wide ? 0 : undefined}
      gap="$lg"
      padding="$xxl"
    >
      <Row justifyContent="space-between" flexWrap="wrap">
        <Row gap="$md">
          <Icon name={icon} size="lg" color="$accent" />
          <Text variant="heading" color="$colorStrong">
            {title}
          </Text>
        </Row>
        <Pill label={pill} tone={tone} size="sm" />
      </Row>
      <Text color="$colorMuted">{body}</Text>
    </Card>
  );
}

export function HowItWorks() {
  const { wide } = useMedia();
  const Columns = wide ? Row : Stack;
  return (
    <SiteSection id={sectionIds.howItWorks}>
      <Reveal>
        <SectionHeading eyebrow={how.eyebrow} title={how.title} />
      </Reveal>
      <Reveal>
        <Columns gap="$lg" alignItems="stretch">
          {how.steps.map((step, index) => (
            <Card
              key={step.title}
              flex={wide ? 1 : undefined}
              flexBasis={wide ? 0 : undefined}
              gap="$lg"
              padding="$xxl"
            >
              <Row justifyContent="space-between">
                <IconTile icon={step.icon} />
                <Text variant="display" color="$neutral">
                  {index + 1}
                </Text>
              </Row>
              <Stack gap="$xs">
                <Text variant="title" color="$colorStrong">
                  {step.title}
                </Text>
                <Text color="$colorMuted">{step.body}</Text>
              </Stack>
            </Card>
          ))}
        </Columns>
      </Reveal>
      <Reveal>
        <Columns gap="$lg" alignItems="stretch">
          <MethodCard icon="Landmark" tone="info" {...how.bank} />
          <MethodCard icon="Bitcoin" tone="accent" {...how.bitcoin} />
        </Columns>
      </Reveal>
    </SiteSection>
  );
}
