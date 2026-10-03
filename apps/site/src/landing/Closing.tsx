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
      <Stack alignItems="center" gap="$xl" paddingVertical="$xxxl">
        <Row gap="$xxl" role="img" aria-label={copy.closingImageAlt}>
          {notNeeded.map((icon) => (
            <Icon key={icon} name={icon} size="lg" color="$accent" />
          ))}
        </Row>
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
          alignItems="center"
          gap="$xxxl"
          paddingVertical="$huge"
        >
          <Glow size="40%" top="30%" left="50%" />
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
