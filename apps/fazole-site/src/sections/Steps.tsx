import { Row, Stack, Text, useMedia } from "@linky-fit/ui";
import { useEffect, useRef, useState } from "react";
import { copy } from "../copy";
import type { Step, StoryScreenKey } from "../copy";
import { PhoneFrame } from "../demo/chrome";
import { storyLabels, storyScreen } from "../demo/story";
import { Glow, Reveal, SectionHeading, SiteSection } from "./parts";
import { sectionIds } from "./sectionIds";

const { steps } = copy;

const stepNumber = (index: number) => String(index + 1).padStart(2, "0");

function StepText({ step, index }: { step: Step; index: number }) {
  return (
    <Stack gap="$lg" maxWidth="$sheetWidth">
      <Text variant="label" mono color="$accent">
        {stepNumber(index)}
      </Text>
      <Text variant="amount" color="$colorStrong" role="heading" aria-level={3}>
        {step.title}
      </Text>
      <Text variant="title" fontWeight="$regular" color="$colorMuted">
        {step.body}
      </Text>
    </Stack>
  );
}

/** A phone frozen on the story's screens, inert: the live demo is in the hero. */
function StoryPhone({
  screens,
  active,
  maxWidth,
}: {
  screens: readonly StoryScreenKey[];
  active: StoryScreenKey;
  maxWidth: number;
}) {
  return (
    <PhoneFrame accessibilityLabel={storyLabels[active]} maxWidth={maxWidth}>
      {screens.map((key) => (
        <Stack
          key={key}
          {...{ inert: true }}
          aria-hidden
          position="absolute"
          inset={0}
          gap="$none"
          pointerEvents="none"
          opacity={key === active ? 1 : 0}
          scale={key === active ? 1 : 1.04}
          transition="slow"
        >
          {storyScreen(key)}
        </Stack>
      ))}
    </PhoneFrame>
  );
}

/** Tracks which step crosses the middle of the viewport. */
function useActiveStep(first: StoryScreenKey) {
  const nodes = useRef(new Map<Element, StoryScreenKey>());
  const [active, setActive] = useState(first);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const key = nodes.current.get(entry.target);
          if (entry.isIntersecting && key) setActive(key);
        }
      },
      { rootMargin: "-50% 0px -50% 0px" },
    );
    for (const node of nodes.current.keys()) observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const register = (key: StoryScreenKey) => (node: unknown) => {
    if (node instanceof Element) nodes.current.set(node, key);
  };
  return { register, active };
}

const screens = steps.items.map((step) => step.screen);

/** The steps scroll past one phone that stays put and turns to each step's screen. */
function StickyStory() {
  const { register, active } = useActiveStep("amount");
  return (
    <Row alignItems="flex-start" gap="$huge">
      <Stack flex={1} flexBasis={0} gap="$none">
        {steps.items.map((step, index) => (
          <Stack
            key={step.screen}
            ref={register(step.screen)}
            minHeight={560}
            justifyContent="center"
            opacity={step.screen === active ? 1 : 0.28}
            transition="base"
          >
            <StepText step={step} index={index} />
          </Stack>
        ))}
      </Stack>
      <Stack flex={1} flexBasis={0} alignSelf="stretch" gap="$none">
        <Row
          position="sticky"
          top={112}
          justifyContent="center"
          gap="$xxl"
          paddingVertical="$xl"
        >
          <Glow />
          <StoryPhone screens={screens} active={active} maxWidth={320} />
          <Stack gap="$sm" aria-hidden>
            {screens.map((key) => (
              <Stack
                key={key}
                width={6}
                height={key === active ? 48 : 16}
                borderRadius="$pill"
                backgroundColor={key === active ? "$accent" : "$neutralSoft"}
                transition="slow"
              />
            ))}
          </Stack>
        </Row>
      </Stack>
    </Row>
  );
}

/** On phones every step has its own phone below its text. */
function StackedStory() {
  return (
    <Stack gap="$huge">
      {steps.items.map((step, index) => (
        <Reveal key={step.screen}>
          <Stack gap="$xxxl">
            <StepText step={step} index={index} />
            <Stack alignItems="center" position="relative" gap="$none">
              <Glow />
              <StoryPhone
                screens={[step.screen]}
                active={step.screen}
                maxWidth={300}
              />
            </Stack>
          </Stack>
        </Reveal>
      ))}
    </Stack>
  );
}

export function Steps() {
  const { wide } = useMedia();
  return (
    <SiteSection id={sectionIds.steps}>
      <Reveal>
        <SectionHeading title={steps.title} />
      </Reveal>
      {wide ? <StickyStory /> : <StackedStory />}
    </SiteSection>
  );
}
