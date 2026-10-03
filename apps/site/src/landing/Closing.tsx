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
      <Stack alignItems="center" gap="$xxl" paddingVertical="$huge">
        <Row
          gap={wide ? "$xxl" : "$lg"}
          role="img"
          aria-label={copy.closingImageAlt}
        >
          {notNeeded.map((icon) => (
            <Stack
              key={icon}
              width={wide ? "$hero" : "$row"}
              height={wide ? "$hero" : "$row"}
              borderRadius="$pill"
              alignItems="center"
              justifyContent="center"
              backgroundColor="$surface"
              borderWidth={1}
              borderColor="$borderColor"
            >
              <Icon name={icon} size={wide ? "xl" : "lg"} color="$accent" />
            </Stack>
          ))}
        </Row>
        <Text eyebrow color="$accent">
          {copy.closingSectionTitle}
        </Text>
        <Text
          variant={wide ? "amount" : "display"}
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
    <Reveal>
      <Stack
        position="relative"
        overflow="hidden"
        alignItems="center"
        gap="$xxl"
        paddingVertical="$huge"
        paddingHorizontal={wide ? "$huge" : "$xl"}
        marginBottom="$huge"
        borderRadius="$sheet"
        backgroundColor="$surface"
        borderWidth={1}
        borderColor="$borderColor"
      >
        <Glow size="70%" top="0%" left="50%" />
        <BrandMark size={wide ? "brandHero" : "hero"} />
        <Text
          variant={wide ? "headline" : "amount"}
          color="$colorStrong"
          textAlign="center"
        >
          {copy.title}
        </Text>
        <AppLaunch labels={copy.ctaLabels} centered />
      </Stack>
    </Reveal>
  );
}
