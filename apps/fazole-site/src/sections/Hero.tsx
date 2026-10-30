import {
  Button,
  Icon,
  Image,
  Pill,
  Row,
  Stack,
  Text,
  useMedia,
} from "@linky-fit/ui";
import type { IconName } from "@linky-fit/ui";
import { siteConfig } from "../config";
import { copy } from "../copy";
import { DemoApp } from "../demo/DemoApp";
import { Glow, Handwritten } from "./parts";

const hero = copy.hero;

/** "Vyzkoušejte", written by hand beside the phone, with an arrow into it. */
function TryIt({ wide }: { wide: boolean }) {
  return (
    <Row alignItems="flex-end" gap="$xs" rotate="-4deg">
      <Handwritten>{hero.tryIt}</Handwritten>
      <Icon
        name={wide ? "ArrowRight" : "ArrowDownRight"}
        size="lg"
        color="$accent"
      />
    </Row>
  );
}

/** A way to pay, placed on the stage; its spark travels to the phone along `/stage.svg`. */
function StageNode({
  icon,
  label,
  ...position
}: {
  icon: IconName;
  label: string;
  left?: number | undefined;
  right?: number | undefined;
  top?: number | undefined;
  bottom?: number | undefined;
}) {
  return (
    <Stack position="absolute" zIndex="$raised" gap="$none" {...position}>
      <Pill
        label={label}
        leading={<Icon name={icon} size="sm" color="$accentText" />}
      />
    </Stack>
  );
}

/**
 * The phone with the ways to pay around it: bank transfer and Bitcoin, each
 * sending a spark of light under the phone, like Payky's landing page. The
 * sparks and their dashed paths are an animated SVG stretched over the stage,
 * so the node positions below match its `viewBox` percentages.
 */
function Stage({ wide }: { wide: boolean }) {
  const phoneWidth = wide ? 340 : 320;
  return (
    <Stack
      position="relative"
      width="100%"
      maxWidth={wide ? 600 : 420}
      alignItems="center"
      paddingTop={wide ? "$xxxl" : "$huge"}
      paddingBottom="$xxxl"
      gap="$none"
    >
      <Glow />
      <Image
        src="/stage.svg"
        alt=""
        aria-hidden
        position="absolute"
        top={0}
        left={0}
        width="100%"
        height="100%"
      />
      <Stack
        position="absolute"
        top={wide ? "$xl" : "$sm"}
        left={wide ? "$none" : "$md"}
        gap="$none"
      >
        <TryIt wide={wide} />
      </Stack>
      <StageNode
        icon="Landmark"
        label={hero.stage.bank}
        left={0}
        bottom={wide ? 140 : 120}
      />
      <StageNode
        icon="Bitcoin"
        label={hero.stage.bitcoin}
        right={0}
        top={wide ? 300 : 280}
      />
      <DemoApp
        accessibilityLabel={copy.demo.labels.terminal}
        maxWidth={phoneWidth}
      />
    </Stack>
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
        <Row gap="$xl" flexWrap="wrap">
          {hero.points.map((point) => (
            <Row key={point.label} gap="$xs">
              <Icon name={point.icon} size="sm" color="$colorMuted" />
              <Text variant="label" color="$colorMuted">
                {point.label}
              </Text>
            </Row>
          ))}
        </Row>
        <Row>
          <Button
            render={<a href={siteConfig.webAppUrl} />}
            role="link"
            icon="Play"
            minHeight="$controlLg"
            paddingHorizontal="$xxl"
          >
            {hero.primaryCta}
          </Button>
        </Row>
      </Stack>
      <Stack
        flex={wide ? 1 : undefined}
        flexBasis={wide ? 0 : undefined}
        width="100%"
        alignItems="center"
        gap="$none"
        transition={["slow", { delay: 150 }]}
        enterStyle={{ opacity: 0, y: 40 }}
      >
        <Stage wide={wide} />
      </Stack>
    </Columns>
  );
}
