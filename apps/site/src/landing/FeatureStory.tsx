import { DeviceFrame, Image, Row, Stack, Text, useMedia } from "@linky-fit/ui";
import { useEffect, useRef, useState } from "react";
import { useSystemColorMode } from "../useSystemColorMode";
import type { Feature, LandingCopy } from "./copy";
import { screenSrc } from "./copy";
import { Glow, Phone, Reveal } from "./parts";

const stepNumber = (index: number) => String(index + 1).padStart(2, "0");

function FeatureText({ feature, index }: { feature: Feature; index: number }) {
  return (
    <Stack gap="$lg" maxWidth="$sheetWidth">
      <Text variant="label" mono color="$accent">
        {stepNumber(index)}
      </Text>
      <Text variant="amount" color="$colorStrong" role="heading" aria-level={3}>
        {feature.title}
      </Text>
      <Text variant="title" fontWeight="$regular" color="$colorMuted">
        {feature.description}
      </Text>
    </Stack>
  );
}

/** Tracks which step crosses the middle of the viewport. */
function useActiveStep(count: number) {
  const steps = useRef<(HTMLDivElement | null)[]>([]);
  const [active, setActive] = useState(0);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActive(steps.current.findIndex((step) => step === entry.target));
          }
        }
      },
      { rootMargin: "-50% 0px -50% 0px" },
    );
    for (const step of steps.current) if (step) observer.observe(step);
    return () => observer.disconnect();
  }, [count]);
  return { steps, active };
}

function StickyStory({ features }: { features: Feature[] }) {
  const mode = useSystemColorMode();
  const { steps, active } = useActiveStep(features.length);
  return (
    <Row alignItems="flex-start" gap="$huge">
      <Stack flex={1} gap="$none">
        {features.map((feature, index) => (
          <div
            key={feature.screen}
            ref={(element) => {
              steps.current[index] = element;
            }}
            className={
              index === active ? "landing-step is-active" : "landing-step"
            }
          >
            <FeatureText feature={feature} index={index} />
          </div>
        ))}
      </Stack>
      <Stack flex={1} alignSelf="stretch" gap="$none">
        <div className="landing-sticky">
          <Row justifyContent="center" position="relative" gap="$xxl">
            <Glow size="140%" top="50%" left="50%" />
            <DeviceFrame width="$device">
              {features.map((feature, index) => (
                <div
                  key={feature.screen}
                  className={
                    index === active
                      ? "landing-screen is-active"
                      : "landing-screen"
                  }
                >
                  <Image
                    src={screenSrc(feature.screen, mode)}
                    alt=""
                    width="100%"
                    height="100%"
                    objectFit="cover"
                  />
                </div>
              ))}
            </DeviceFrame>
            <Stack gap="$sm" aria-hidden>
              {features.map((feature, index) => (
                <Stack
                  key={feature.screen}
                  width="$track"
                  height={index === active ? "$avatar" : "$iconSm"}
                  borderRadius="$pill"
                  backgroundColor={
                    index === active ? "$accent" : "$neutralSoft"
                  }
                  transition="slow"
                />
              ))}
            </Stack>
          </Row>
        </div>
      </Stack>
    </Row>
  );
}

function StackedStory({ features }: { features: Feature[] }) {
  return (
    <Stack gap="$huge">
      {features.map((feature, index) => (
        <Reveal key={feature.screen}>
          <Stack gap="$xxxl">
            <FeatureText feature={feature} index={index} />
            <Stack alignItems="center" position="relative" gap="$none">
              <Glow size="120%" top="50%" left="50%" />
              <Phone screen={feature.screen} width="$qr" />
            </Stack>
          </Stack>
        </Reveal>
      ))}
    </Stack>
  );
}

export function FeatureStory({ copy }: { copy: LandingCopy }) {
  const { wide } = useMedia();
  return (
    <Stack gap={wide ? "$none" : "$huge"} paddingVertical="$huge">
      <Reveal>
        <Text
          variant={wide ? "headline" : "amount"}
          color="$colorStrong"
          role="heading"
          aria-level={2}
        >
          {copy.uspSectionTitle}
        </Text>
      </Reveal>
      {wide ? (
        <StickyStory features={copy.features} />
      ) : (
        <StackedStory features={copy.features} />
      )}
    </Stack>
  );
}
