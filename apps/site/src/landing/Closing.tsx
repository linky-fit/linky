import {
  BrandMark,
  Icon,
  Row,
  Stack,
  Text,
  useMedia,
  type IconName,
} from "@linky-fit/ui";
import type { LandingCopy } from "./copy";
import { AppLaunch, Glow, Reveal } from "./parts";

const notNeeded: IconName[] = ["PhoneOff", "MailOff", "IdCardOff"];

export function Privacy({ copy }: { copy: LandingCopy }) {
  const { wide } = useMedia();
  return (
    <Reveal>
      <Stack alignItems="center" gap="$lg" paddingVertical="$xxxl">
        <Row gap="$md" role="img" aria-label={copy.closingImageAlt}>
          {notNeeded.map((icon) => (
            <Stack
              key={icon}
              width="$controlLg"
              height="$controlLg"
              borderRadius="$pill"
              alignItems="center"
              justifyContent="center"
              backgroundColor="$surface"
              borderWidth={1}
              borderColor="$borderColor"
            >
              <Icon name={icon} size="md" color="$accent" />
            </Stack>
          ))}
        </Row>
        <Stack alignItems="center" gap="$sm">
          <Text eyebrow color="$accent">
            {copy.closingSectionTitle}
          </Text>
          <Text
            variant={wide ? "display" : "heading"}
            color="$colorStrong"
            textAlign="center"
            maxWidth="$contentWidth"
            role="heading"
            aria-level={2}
          >
            {copy.closingSectionDescription}
          </Text>
        </Stack>
      </Stack>
    </Reveal>
  );
}

export function ClosingCta({ copy }: { copy: LandingCopy }) {
  const { wide } = useMedia();
  return (
    <Stack id="download" marginBottom="$huge">
      <Reveal>
        <Stack
          position="relative"
          overflow="hidden"
          alignItems="center"
          gap="$xxxl"
          paddingVertical="$huge"
          paddingHorizontal={wide ? "$huge" : "$xl"}
          borderRadius="$sheet"
          backgroundColor="$surface"
          borderWidth={1}
          borderColor="$borderColor"
        >
          <Glow size="70%" top="0%" left="50%" />
          <BrandMark size="hero" />
          <Text
            variant={wide ? "amount" : "display"}
            color="$colorStrong"
            textAlign="center"
            role="heading"
            aria-level={2}
          >
            {copy.getAppTitle}
          </Text>
          <AppLaunch copy={copy} centered />
        </Stack>
      </Reveal>
    </Stack>
  );
}
