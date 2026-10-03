import { useState } from "react";
import type { ReactNode } from "react";
import { Image, View, styled } from "tamagui";
import { Pressable } from "./controls";
import { Row, Stack, Text } from "./layout";
import { toneColors } from "./styles";
import { SupporterBadge } from "./supporter-badge";
import type { SupporterBadgeProps } from "./supporter-badge";
import type { SupporterBadgeKind, TextVariant, Tone } from "./tokens";
import { border, space } from "./tokens";

const avatarSizes = {
  xs: { box: "$iconLg", text: "caption", badge: "dot" },
  sm: { box: "$controlSm", text: "caption", badge: "dot" },
  md: { box: "$avatar", text: "label", badge: "iconSm" },
  lg: { box: "$hero", text: "display", badge: "controlSm" },
} as const satisfies Record<
  string,
  {
    box: `$${string}`;
    text: TextVariant;
    badge: NonNullable<SupporterBadgeProps["size"]>;
  }
>;

export type AvatarSize = keyof typeof avatarSizes;

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => Array.from(part)[0] ?? "")
    .join("")
    .toUpperCase() || "?";

export interface AvatarProps {
  /** The initials come from it; without a name the avatar shows "?". */
  name: string;
  uri?: string | undefined;
  size?: AvatarSize | undefined;
  /** Shows a dot on the edge, e.g. for unread messages. */
  indicator?: Tone | undefined;
  /** Shown instead of the initials without a photo, e.g. an emoji or a letter. */
  fallback?: string | undefined;
  /** Gets the photo uri that failed to load, e.g. to try another source. */
  onError?: ((uri: string) => void) | undefined;
  /** Fills the circle with the raised surface, so it stands out against its ring, e.g. in an `AvatarGroup`. */
  raised?: boolean | undefined;
  /** Shows the supporter badge on the bottom-right edge. */
  supporter?: SupporterBadgeKind | undefined;
}

export function Avatar({
  name,
  uri,
  size = "md",
  indicator,
  fallback,
  onError,
  raised = false,
  supporter,
}: AvatarProps) {
  const dimensions = avatarSizes[size];
  const [failedUri, setFailedUri] = useState<string>();
  const showPhoto = uri !== undefined && uri !== failedUri;
  const glyph = fallback ?? (size === "xs" ? null : initials(name));
  return (
    <View position="relative" flexShrink={0} role="img" aria-label={name}>
      <View
        width={dimensions.box}
        height={dimensions.box}
        borderRadius="$pill"
        overflow="hidden"
        alignItems="center"
        justifyContent="center"
        backgroundColor={raised ? "$surfaceRaised" : "$surface"}
      >
        {showPhoto ? (
          <Image
            src={uri}
            width="100%"
            height="100%"
            objectFit="cover"
            aria-hidden
            onError={() => {
              setFailedUri(uri);
              onError?.(uri);
            }}
          />
        ) : glyph === null ? null : (
          <Text variant={dimensions.text} bold color="$accentText">
            {glyph}
          </Text>
        )}
      </View>
      {indicator ? (
        <View
          position="absolute"
          top={0}
          right={0}
          width="$dot"
          height="$dot"
          borderRadius="$pill"
          borderWidth={border.emphasis}
          borderColor="$background"
          backgroundColor={toneColors[indicator].solid}
          aria-hidden
        />
      ) : null}
      {supporter ? (
        <View
          position="absolute"
          bottom={0}
          right={0}
          borderRadius="$pill"
          borderWidth={border.emphasis}
          borderColor="$background"
          testID="avatar-supporter-badge"
        >
          <SupporterBadge kind={supporter} size={dimensions.badge} />
        </View>
      ) : null}
    </View>
  );
}

export interface AvatarGroupProps {
  people: readonly Pick<AvatarProps, "name" | "uri">[];
  /** How many avatars show before the rest collapse into a `+N` count. */
  max?: number | undefined;
  size?: AvatarSize | undefined;
}

/** Rings each avatar in the page background, so overlapping circles stay apart. */
const AvatarRing = styled(View, {
  borderRadius: "$pill",
  borderWidth: border.emphasis,
  borderColor: "$background",
});

/** A few people as overlapping avatars, e.g. who pays in a currency. */
export function AvatarGroup({
  people,
  max = 5,
  size = "sm",
}: AvatarGroupProps) {
  const dimensions = avatarSizes[size];
  const hidden = people.length - max;
  return (
    <Row gap="$none">
      {people.slice(0, max).map((person, index) => (
        <AvatarRing
          key={`${index}-${person.name}`}
          marginLeft={index === 0 ? space.none : -space.md}
        >
          <Avatar name={person.name} uri={person.uri} size={size} raised />
        </AvatarRing>
      ))}
      {hidden > 0 ? (
        <AvatarRing marginLeft={-space.md}>
          <View
            width={dimensions.box}
            height={dimensions.box}
            borderRadius="$pill"
            alignItems="center"
            justifyContent="center"
            backgroundColor="$surfaceRaised"
          >
            <Text variant="caption" bold color="$colorSubtle">
              +{hidden}
            </Text>
          </View>
        </AvatarRing>
      ) : null}
    </Row>
  );
}

export interface StatusDotProps {
  tone: Tone;
  accessibilityLabel: string;
}

export function StatusDot({ tone, accessibilityLabel }: StatusDotProps) {
  return (
    <View
      role="img"
      aria-label={accessibilityLabel}
      width="$dot"
      height="$dot"
      flexShrink={0}
      borderRadius="$pill"
      backgroundColor={toneColors[tone].solid}
    />
  );
}

export interface PillProps {
  label: string;
  /** Secondary text after the label, e.g. a mint host. */
  hint?: string | undefined;
  leading?: ReactNode;
  tone?: Tone | undefined;
  /** `sm` fits a line of caption text, e.g. a list preview. */
  size?: "sm" | "md" | undefined;
  onPress?: (() => void) | undefined;
  accessibilityLabel?: string | undefined;
  testID?: string | undefined;
}

/** An inline entity: a token, a contact mention or a payment state. */
export function Pill({
  label,
  hint,
  leading,
  tone = "accent",
  size = "md",
  onPress,
  accessibilityLabel,
  testID,
}: PillProps) {
  const colors = toneColors[tone];
  const Frame = onPress ? Pressable : Row;
  const small = size === "sm";
  return (
    <Frame
      testID={testID}
      onPress={onPress}
      aria-label={accessibilityLabel}
      alignSelf="flex-start"
      // Flows inline with message text on the web; native text lays out nested views inline already.
      $platform-web={{ display: "inline-flex" }}
      gap="$xs"
      minHeight={small ? "$none" : "$controlSm"}
      paddingHorizontal={small ? "$sm" : "$md"}
      paddingVertical={small ? "$xxs" : "$none"}
      borderRadius="$pill"
      backgroundColor={colors.background}
    >
      {leading}
      <Text
        variant={small ? "caption" : "label"}
        bold
        color={colors.color}
        numberOfLines={1}
        flexShrink={1}
      >
        {label}
      </Text>
      {hint ? (
        <Text
          variant="caption"
          color={colors.color}
          numberOfLines={1}
          flexShrink={1}
        >
          {hint}
        </Text>
      ) : null}
    </Frame>
  );
}

export interface AmountProps {
  value: string;
  unit?: string | undefined;
  caption?: string | undefined;
  size?: "md" | "lg" | undefined;
}

export function Amount({ value, unit, caption, size = "lg" }: AmountProps) {
  return (
    <Stack gap="$xs" alignItems="center">
      <Row
        gap="$sm"
        alignItems="baseline"
        justifyContent="center"
        flexWrap="wrap"
      >
        <Text
          variant={size === "lg" ? "amount" : "display"}
          color="$colorStrong"
          textAlign="center"
          fontVariant={["tabular-nums"]}
        >
          {value}
        </Text>
        {unit ? (
          <Text variant="caption" bold color="$colorMuted">
            {unit}
          </Text>
        ) : null}
      </Row>
      {caption ? (
        <Text variant="caption" color="$colorMuted" textAlign="center">
          {caption}
        </Text>
      ) : null}
    </Stack>
  );
}
