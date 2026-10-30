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
import type { ReactNode } from "react";
import { siteConfig } from "../config";
import { DemoApp } from "../demo/DemoApp";
import { useCopy } from "../locale";
import { Glow, Handwritten } from "./parts";

/** "Vyzkoušejte", written by hand beside the phone, with an arrow into it. */
function TryIt({ wide }: { wide: boolean }) {
  const { hero } = useCopy();
  return (
    <Row alignItems="flex-end" gap="$xs" rotate="-4deg" flexShrink={0}>
      <Handwritten>{hero.tryIt}</Handwritten>
      <Icon
        name={wide ? "ArrowRight" : "ArrowDownRight"}
        size="lg"
        color="$accent"
      />
    </Row>
  );
}

type Percent = `${number}%`;

/**
 * Places its child on the stage at `top`, in a band from `left` of `width`
 * (both percentages of the stage), aligned to the band's start or end. Widths
 * are the one percentage the UI tokens allow, so the band does the placing.
 */
function Placed({
  top,
  left = "0%",
  width = "100%",
  align = "start",
  children,
}: {
  top: Percent;
  left?: Percent | undefined;
  width?: Percent | undefined;
  align?: "start" | "end" | undefined;
  children: ReactNode;
}) {
  return (
    <Stack
      position="absolute"
      top={0}
      left={0}
      right={0}
      bottom={0}
      gap="$none"
      pointerEvents="box-none"
    >
      <Stack height={top} />
      <Row gap="$none" alignItems="flex-start" pointerEvents="box-none">
        <Stack width={left} />
        <Row
          width={width}
          justifyContent={align === "end" ? "flex-end" : "flex-start"}
          pointerEvents="box-none"
        >
          {children}
        </Row>
      </Row>
    </Stack>
  );
}

/** A way to pay, placed on the stage; its spark travels to the phone along `/stage.svg`. */
function StageNode({ icon, label }: { icon: IconName; label: string }) {
  return (
    <Stack zIndex="$raised" gap="$none">
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
 * sparks and their dashed paths are an animated SVG drawn in a 600×820 box;
 * the stage keeps that aspect ratio and places everything in percentages of
 * it, so the paths meet the labels and the phone at every width.
 */
function Stage() {
  const { hero, demo } = useCopy();
  return (
    <Stack
      position="relative"
      width="100%"
      maxWidth={600}
      aspectRatio={600 / 820}
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
      <Placed top="7%" left="23%" width="54%">
        <Stack width="100%" gap="$none">
          <DemoApp accessibilityLabel={demo.labels.terminal} maxWidth={324} />
        </Stack>
      </Placed>
      {/* Ends where the phone starts and runs out to the left as far as it needs. */}
      <Placed top="17%" width="21%" align="end">
        <TryIt wide />
      </Placed>
      <Placed top="82%">
        <StageNode icon="Landmark" label={hero.stage.bank} />
      </Placed>
      <Placed top="36%" align="end">
        <StageNode icon="Bitcoin" label={hero.stage.bitcoin} />
      </Placed>
    </Stack>
  );
}

export function Hero() {
  const { hero, demo } = useCopy();
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
        position="relative"
        alignItems="center"
        gap="$none"
        transition={["slow", { delay: 150 }]}
        enterStyle={{ opacity: 0, y: 40 }}
      >
        {wide ? (
          <Stage />
        ) : (
          <Stack width="100%" maxWidth={360} gap="$sm">
            <TryIt wide={false} />
            <DemoApp accessibilityLabel={demo.labels.terminal} maxWidth={360} />
          </Stack>
        )}
      </Stack>
    </Columns>
  );
}
