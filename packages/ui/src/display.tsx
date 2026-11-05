import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useWindowDimensions } from "react-native";
import type { ReactNode } from "react";
import { Image, View, isWeb, styled } from "tamagui";
import type { TamaguiElement } from "tamagui";
import { IndicatorDot, Pressable } from "./controls";
import { Icon } from "./icons";
import type { IconName, IconSize } from "./icons";
import { Row, Stack, Text } from "./layout";
import { toneColors } from "./styles";
import type { TextVariant, Tone } from "./tokens";
import { border, space, typography } from "./tokens";

const avatarSizes = {
  xs: { box: "$iconLg", text: "caption" },
  sm: { box: "$controlSm", text: "caption" },
  md: { box: "$avatar", text: "label" },
  lg: { box: "$hero", text: "display" },
} as const satisfies Record<string, { box: `$${string}`; text: TextVariant }>;

export type AvatarSize = keyof typeof avatarSizes;

const avatarIconSizes = {
  xs: "sm",
  sm: "sm",
  md: "lg",
  lg: "xl",
} as const satisfies Record<AvatarSize, IconSize>;

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => Array.from(part)[0] ?? "")
    .join("")
    .toUpperCase() || "?";

const initialsTones = ["accent", "info", "warning", "danger"] as const;

/** The same name always gets the same tint, so people stay recognisable without a photo. */
const initialsTone = (name: string): Tone => {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) | 0;
  return initialsTones[Math.abs(hash) % initialsTones.length] ?? "accent";
};

export interface AvatarProps {
  /** The initials come from it; without a name the avatar shows "?". */
  name: string;
  uri?: string | undefined;
  size?: AvatarSize | undefined;
  /** Shows a dot on the edge, e.g. for unread messages. */
  indicator?: Tone | undefined;
  /** Shown instead of the initials without a photo, e.g. an emoji or a letter. */
  fallback?: string | undefined;
  /** An icon instead of the initials without a photo, e.g. for a company without a logo. */
  icon?: IconName | undefined;
  /** Fixes the tint instead of deriving it from the name, e.g. accent for an add action in a list of people. */
  tone?: Tone | undefined;
  /** Gets the photo uri that failed to load, e.g. to try another source. */
  onError?: ((uri: string) => void) | undefined;
  /** Puts a photo on the raised surface while it loads, so it stands out against its ring, e.g. in an `AvatarGroup`. */
  raised?: boolean | undefined;
}

export function Avatar({
  name,
  uri,
  size = "md",
  indicator,
  fallback,
  icon,
  tone,
  onError,
  raised = false,
}: AvatarProps) {
  const dimensions = avatarSizes[size];
  const [failedUri, setFailedUri] = useState<string>();
  const showPhoto = uri !== undefined && uri !== failedUri;
  const glyph = fallback ?? (size === "xs" ? null : initials(name));
  const tint = toneColors[tone ?? initialsTone(name)];
  const photoFill = raised ? "$surfaceRaised" : "$surface";
  return (
    <View position="relative" flexShrink={0} role="img" aria-label={name}>
      <View
        width={dimensions.box}
        height={dimensions.box}
        borderRadius="$pill"
        overflow="hidden"
        alignItems="center"
        justifyContent="center"
        backgroundColor={showPhoto ? photoFill : tint.background}
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
        ) : icon ? (
          <Icon name={icon} size={avatarIconSizes[size]} color={tint.color} />
        ) : glyph === null ? null : (
          <Text variant={dimensions.text} bold color={tint.color}>
            {glyph}
          </Text>
        )}
      </View>
      {indicator ? <IndicatorDot tone={indicator} /> : null}
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
  padding: border.emphasis,
  backgroundColor: "$background",
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
  testID?: string | undefined;
}

export function StatusDot({
  tone,
  accessibilityLabel,
  testID,
}: StatusDotProps) {
  return (
    <View
      role="img"
      aria-label={accessibilityLabel}
      testID={testID}
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
  size?: "md" | "lg" | "xl" | undefined;
}

const amountVariant = {
  md: "display",
  lg: "amount",
  xl: "headline",
} as const satisfies Record<NonNullable<AmountProps["size"]>, TextVariant>;

/** The unit stays about a third of its figure, so it reads as part of the amount. */
const unitVariant = {
  display: "label",
  amount: "title",
  headline: "display",
} as const satisfies Record<
  (typeof amountVariant)[keyof typeof amountVariant],
  TextVariant
>;

const scaledText = (variant: TextVariant, scale: number) => ({
  fontSize: typography.size[variant] * scale,
  lineHeight: typography.lineHeight[variant] * scale,
});

/** The factor that shrinks a one-line web text to its width; native text fits itself with `adjustsFontSizeToFit`. */
const useFitScale = (text: string) => {
  const ref = useRef<TamaguiElement>(null);
  const { width } = useWindowDimensions();
  const key = `${text}@${width}`;
  const [fit, setFit] = useState({ key, scale: 1 });
  const scale = fit.key === key ? fit.scale : 1;
  const shrinkToFit = useCallback(() => {
    const node = ref.current;
    if (!isWeb || !(node instanceof HTMLElement)) return;
    if (node.scrollWidth > node.clientWidth) {
      setFit({ key, scale: (scale * node.clientWidth) / node.scrollWidth });
    }
  }, [key, scale]);
  useLayoutEffect(shrinkToFit, [shrinkToFit]);
  return { ref, scale, shrinkToFit };
};

export function Amount({ value, unit, caption, size = "lg" }: AmountProps) {
  const variant = amountVariant[size];
  const { ref, scale, shrinkToFit } = useFitScale(`${value} ${unit ?? ""}`);
  return (
    <Stack gap="$xs" alignItems="center" maxWidth="100%">
      <Text
        ref={ref}
        // A narrower column or the web font swapping in resizes the text.
        onLayout={shrinkToFit}
        variant={variant}
        {...scaledText(variant, scale)}
        numberOfLines={1}
        adjustsFontSizeToFit
        color="$colorStrong"
        textAlign="center"
        fontVariant={["tabular-nums"]}
      >
        {value}
        {unit ? (
          <Text
            variant={unitVariant[variant]}
            {...scaledText(unitVariant[variant], scale)}
            fontWeight="$semibold"
            color="$colorMuted"
          >
            {` ${unit}`}
          </Text>
        ) : null}
      </Text>
      {caption ? (
        <Text variant="caption" color="$colorMuted" textAlign="center">
          {caption}
        </Text>
      ) : null}
    </Stack>
  );
}
