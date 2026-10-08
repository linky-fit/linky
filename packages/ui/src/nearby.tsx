import type { ReactNode } from "react";
import { View } from "tamagui";
import { Pressable } from "./controls";
import { Avatar } from "./display";
import { Icon } from "./icons";
import { Row, ScrollView, Text } from "./layout";
import { toneColors } from "./styles";
import { border, opacity, space, typography } from "./tokens";

/** Whether a beacon says its owner buys or sells bitcoin. */
export type NearbyTrade = "buy" | "sell";

const tradeColors = { buy: toneColors.accent, sell: toneColors.info };

const rowGap = space.xs;

const badgeHeight = typography.lineHeight.caption + 2 * border.emphasis;

export type NearbyAvatarProps = {
  name: string;
  imageUrl?: string | undefined;
  /** Short text under the circle, e.g. a first name or "You". */
  label?: string | undefined;
  /** Rings the user's own avatar in a quieter color than the contacts'. */
  isSelf?: boolean | undefined;
  onPress: () => void;
  /** Defaults to the name followed by the badge. */
  accessibilityLabel?: string | undefined;
} & (
  | { trade: NearbyTrade; badgeLabel: string }
  | { trade?: undefined; badgeLabel?: undefined }
);

/** One person in a `NearbyRow`: a ringed avatar with the trade as a badge on the ring. */
export function NearbyAvatar({
  name,
  imageUrl,
  label,
  isSelf = false,
  trade,
  badgeLabel,
  onPress,
  accessibilityLabel,
}: NearbyAvatarProps) {
  return (
    <Pressable
      onPress={onPress}
      aria-label={
        accessibilityLabel ?? (badgeLabel ? `${name}, ${badgeLabel}` : name)
      }
      flexDirection="column"
      width="$row"
      flexShrink={0}
      pressStyle={{ opacity: opacity.dimmed }}
    >
      <View
        padding="$xxs"
        borderRadius="$pill"
        borderWidth={border.emphasis}
        borderColor={isSelf ? "$neutral" : "$accent"}
      >
        <Avatar name={name} uri={imageUrl} />
      </View>
      {/* Pulled over the ring's bottom and into half of each row gap; kept without a trade so labels line up. */}
      <View
        height={badgeHeight}
        marginTop={-space.sm}
        marginHorizontal={-rowGap / 2}
        alignSelf="stretch"
        alignItems="center"
      >
        {trade ? (
          <View
            padding={border.emphasis}
            borderRadius="$pill"
            backgroundColor="$background"
            maxWidth="100%"
          >
            <View
              paddingHorizontal="$xxs"
              borderRadius="$pill"
              backgroundColor={tradeColors[trade].background}
            >
              <Text
                variant="caption"
                bold
                color={tradeColors[trade].color}
                numberOfLines={1}
              >
                {badgeLabel}
              </Text>
            </View>
          </View>
        ) : null}
      </View>
      {label ? (
        <Text
          variant="caption"
          color="$colorSubtle"
          numberOfLines={1}
          textAlign="center"
          alignSelf="stretch"
          marginTop="$xxs"
        >
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}

export interface NearbyRowProps {
  children: ReactNode;
  accessibilityLabel?: string | undefined;
}

/** Scrolls `NearbyAvatar`s sideways; it bleeds through the `$xl` page gutter to the screen edges. */
export function NearbyRow({ children, accessibilityLabel }: NearbyRowProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      role="group"
      aria-label={accessibilityLabel}
      flexGrow={0}
      marginHorizontal={-space.xl}
      contentContainerStyle={{
        gap: rowGap,
        paddingHorizontal: space.xl,
        paddingVertical: space.xs,
      }}
    >
      {children}
    </ScrollView>
  );
}

export interface NearbyBannerProps {
  /** E.g. "Nearby" or "Nearby, buys BTC". */
  label: string;
  onPress?: (() => void) | undefined;
}

const bannerFrame = {
  gap: "$sm",
  paddingHorizontal: "$xl",
  paddingVertical: "$sm",
  backgroundColor: "$surfaceRaised",
} as const;

/** A flat strip under a conversation's top bar while the peer is nearby; place it edge to edge. */
export function NearbyBanner({ label, onPress }: NearbyBannerProps) {
  const content = (
    <>
      <Icon name="Radio" size="sm" color="$accent" />
      <Text variant="label" color="$color" flex={1} numberOfLines={1}>
        {label}
      </Text>
    </>
  );
  return onPress ? (
    <Pressable
      onPress={onPress}
      pressStyle={{ opacity: opacity.dimmed }}
      {...bannerFrame}
    >
      {content}
      <Icon name="ChevronRight" size="sm" color="$colorMuted" />
    </Pressable>
  ) : (
    <Row role="status" {...bannerFrame}>
      {content}
    </Row>
  );
}
