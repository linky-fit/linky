import {
  Avatar,
  Button,
  Card,
  Icon,
  Pill,
  Row,
  Stack,
  Text,
} from "@linky-fit/ui";
import { border } from "@linky-fit/ui/tokens";
import type { ComponentProps, ReactNode } from "react";
import { noop } from "./noop";
import { avatarUri, type Person } from "./people";
import { tradeLabel, type NearbyContact, type Trade } from "./trade";

const firstName = (person: Person) => person.split(" ")[0] ?? person;

/** A touch mark over the element the user taps next in a journey. */
export function Tapped({
  on = true,
  atStart = false,
  children,
  ...props
}: {
  on?: boolean;
  /** Marks the row's label instead of its middle. */
  atStart?: boolean;
} & ComponentProps<typeof Stack>) {
  return (
    <Stack position="relative" {...props}>
      {children}
      {on ? (
        <Stack
          position="absolute"
          top="$none"
          bottom="$none"
          left="$none"
          right="$none"
          alignItems={atStart ? "flex-start" : "center"}
          paddingLeft={atStart ? "$xxl" : "$none"}
          justifyContent="center"
          pointerEvents="none"
        >
          <Stack
            width={48}
            height={48}
            borderRadius="$pill"
            borderWidth={border.emphasis}
            borderColor="$surface"
            backgroundColor="$colorMuted"
            opacity={0.55}
          />
        </Stack>
      ) : null}
    </Stack>
  );
}

// Half the height of a small pill.
const badgeOverlap = 10;

/** One avatar in the Nearby row: a ring, and the trade on the avatar. */
function StoryAvatar({
  person,
  label,
  trade,
}: {
  person: Person;
  label: string;
  trade?: Trade | undefined;
}) {
  return (
    <Stack minWidth={68} alignItems="center">
      <Stack
        padding={3}
        borderRadius="$pill"
        borderWidth={border.focus}
        borderColor="$accent"
      >
        <Avatar name={person} uri={avatarUri(person)} />
      </Stack>
      {/* The badge overlaps the ring's bottom yet stays in flow, so a wide badge widens its column. */}
      {trade ? (
        <Stack
          marginTop={-badgeOverlap}
          borderRadius="$pill"
          backgroundColor="$background"
        >
          <Pill
            size="sm"
            tone={trade === "buy" ? "accent" : "info"}
            label={tradeLabel(trade)}
          />
        </Stack>
      ) : (
        <Stack height={badgeOverlap} />
      )}
      <Text
        variant="caption"
        color="$colorSubtle"
        numberOfLines={1}
        marginTop="$xs"
      >
        {label}
      </Text>
    </Stack>
  );
}

/** The Nearby row: the user first while their trade is not None, then nearby contacts, those with a trade first. */
export function StoriesRow({
  me,
  myTrade,
  nearby,
  tapped,
}: {
  me: Person;
  myTrade?: Trade | undefined;
  nearby: readonly NearbyContact[];
  /** The person whose story the journey taps. */
  tapped?: Person | undefined;
}) {
  const ordered = [
    ...nearby.filter(({ trade }) => trade),
    ...nearby.filter(({ trade }) => !trade),
  ];
  return (
    <Row gap="$xs" paddingVertical="$sm" overflow="hidden">
      {myTrade ? (
        <Tapped on={tapped === me}>
          <StoryAvatar person={me} label="You" trade={myTrade} />
        </Tapped>
      ) : null}
      {ordered.map(({ person, trade }) => (
        <Tapped key={person} on={tapped === person}>
          <StoryAvatar
            person={person}
            label={firstName(person)}
            trade={trade}
          />
        </Tapped>
      ))}
    </Row>
  );
}

/** The chat banner while the contact is nearby, with their trade if they set one; edge to edge under the top bar. */
export function NearbyBanner({ trade }: { trade?: Trade | undefined }) {
  return (
    <Row
      gap="$sm"
      paddingHorizontal="$xl"
      paddingVertical="$sm"
      backgroundColor="$surfaceRaised"
      role="status"
    >
      <Icon name="Radio" size="sm" color="$accent" />
      <Text variant="label" color="$color" flex={1} numberOfLines={1}>
        {trade ? `Nearby, ${tradeLabel(trade).toLowerCase()}` : "Nearby"}
      </Text>
    </Row>
  );
}

/** An Android notification card as the shade and heads-up show it. */
export function AndroidNotification({
  title,
  text,
  time = "now",
  person,
  actions = [],
  ongoing = false,
}: {
  title: string;
  text: string;
  time?: string;
  person?: Person;
  actions?: readonly string[];
  ongoing?: boolean;
}) {
  return (
    <Card padding="$lg" gap="$sm" borderRadius="$sheet" elevated>
      <Row gap="$sm">
        <Stack
          width={22}
          height={22}
          borderRadius="$pill"
          backgroundColor="$accent"
          alignItems="center"
          justifyContent="center"
        >
          <Icon name="Radio" size="sm" color="$onAccent" />
        </Stack>
        <Text variant="caption" color="$colorMuted">
          {`Linky · ${ongoing ? "Beacon" : "Nearby"} · ${time}`}
        </Text>
      </Row>
      <Row gap="$md" alignItems="flex-start">
        <Stack flex={1} gap="$xxs">
          <Text fontWeight="$semibold" color="$colorStrong">
            {title}
          </Text>
          <Text variant="label" fontWeight="$regular" color="$colorSubtle">
            {text}
          </Text>
        </Stack>
        {person ? (
          <Avatar name={person} uri={avatarUri(person)} size="sm" />
        ) : null}
      </Row>
      {actions.length > 0 ? (
        <Row gap="$lg" paddingTop="$xs">
          {actions.map((label) => (
            <Text key={label} variant="label" color="$accentText">
              {label}
            </Text>
          ))}
        </Row>
      ) : null}
    </Card>
  );
}

/** Android 12's runtime prompt for the Nearby devices permission group. */
export function PermissionDialog({ tapAllow = false }: { tapAllow?: boolean }) {
  return (
    <Stack
      position="absolute"
      top="$none"
      bottom="$none"
      left="$none"
      right="$none"
      zIndex="$overlay"
      backgroundColor="$scrim"
      justifyContent="center"
      padding="$xxl"
    >
      <Card padding="$xxl" gap="$xl" borderRadius="$sheet" alignItems="center">
        <Icon name="Smartphone" size="lg" color="$accentText" />
        <Text variant="title" textAlign="center" color="$colorStrong">
          Allow Linky to find, connect to, and determine the relative position
          of nearby devices?
        </Text>
        <Stack gap="$sm" alignSelf="stretch">
          <PromptButton tapped={tapAllow}>Allow</PromptButton>
          <PromptButton>Don't allow</PromptButton>
        </Stack>
      </Card>
    </Stack>
  );
}

function PromptButton({
  tapped = false,
  children,
}: {
  tapped?: boolean;
  children: ReactNode;
}) {
  return (
    <Tapped on={tapped}>
      <Button variant="accent" onPress={noop}>
        {children}
      </Button>
    </Tapped>
  );
}
