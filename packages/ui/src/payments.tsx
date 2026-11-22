import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Animated, PanResponder, StyleSheet } from "react-native";
import type { PanResponderGestureState } from "react-native";
import QRCodeSvg from "react-native-qrcode-svg";
import { getVariableValue, isWeb, Portal, useTheme, View } from "tamagui";
import type { TamaguiElement } from "tamagui";
import { Button, Pressable } from "./controls";
import { Amount, Avatar } from "./display";
import { Spinner } from "./spinner";
import { Icon } from "./icons";
import type { IconName } from "./icons";
import { Row, Stack, Text } from "./layout";
import { tooltipProps } from "./styles";
import { duration, enterScale, shadow, size as sizes, space } from "./tokens";

export type KeypadKey =
  | "0"
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "."
  | "C"
  | "⌫";

export interface KeypadProps {
  accessibilityLabel: string;
  onKeyPress: (key: KeypadKey) => void;
  /** Shows a decimal point instead of the clear key. */
  decimal?: boolean | undefined;
  disabled?: boolean | undefined;
  labels: { clear: string; decimal: string; delete: string };
}

const digitRows = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
] as const;

export function Keypad({
  accessibilityLabel,
  onKeyPress,
  decimal = false,
  disabled,
  labels,
}: KeypadProps) {
  const rows: readonly (readonly KeypadKey[])[] = [
    ...digitRows,
    [decimal ? "." : "C", "0", "⌫"],
  ];
  const keyLabel = (key: KeypadKey) =>
    key === "C"
      ? labels.clear
      : key === "."
        ? labels.decimal
        : key === "⌫"
          ? labels.delete
          : key;
  return (
    <Stack role="group" aria-label={accessibilityLabel} gap="$xs">
      {rows.map((keys) => (
        <Row key={keys.join("")} gap="$xs">
          {keys.map((key) => (
            <Button
              key={key}
              variant="ghost"
              flex={1}
              minHeight="$row"
              borderRadius="$card"
              disabled={disabled}
              aria-label={keyLabel(key)}
              onPress={() => onKeyPress(key)}
            >
              {key === "⌫" ? (
                <Icon name="Delete" size="lg" color="$colorSubtle" />
              ) : (
                <Text
                  variant="display"
                  fontWeight="$semibold"
                  color={key === "C" ? "$colorMuted" : "$colorStrong"}
                >
                  {key === "." ? labels.decimal : key}
                </Text>
              )}
            </Button>
          ))}
        </Row>
      ))}
    </Stack>
  );
}

export interface QRCodeProps {
  value: string;
  accessibilityLabel: string;
  onPress?: (() => void) | undefined;
  testID?: string | undefined;
  /** An icon in a cleared centre, e.g. a hint that pressing the code copies it. */
  badge?: IconName | undefined;
  /** A browser tooltip on the web; ignored on native. */
  tooltip?: string | undefined;
}

/** A QR code on a white tile, scannable in both themes. */
export function QRCode({
  value,
  accessibilityLabel,
  onPress,
  testID,
  badge,
  tooltip,
}: QRCodeProps) {
  const theme = useTheme();
  const Frame = onPress ? Pressable : View;
  return (
    <Frame
      testID={testID}
      role={onPress ? "button" : "img"}
      aria-label={accessibilityLabel}
      {...tooltipProps(tooltip)}
      onPress={onPress}
      position="relative"
      padding="$lg"
      borderRadius="$card"
      backgroundColor="$qrBackground"
      alignSelf="center"
    >
      <QRCodeSvg
        value={value}
        size={sizes.qr}
        color={getVariableValue(theme.qrForeground)}
        backgroundColor={getVariableValue(theme.qrBackground)}
        // The badge hides the centre modules; the highest level restores them.
        ecl={badge ? "H" : "M"}
      />
      {badge ? (
        <View
          position="absolute"
          inset={0}
          alignItems="center"
          justifyContent="center"
          pointerEvents="none"
        >
          <View
            width="$controlLg"
            height="$controlLg"
            borderRadius="$pill"
            backgroundColor="$qrBackground"
            alignItems="center"
            justifyContent="center"
          >
            <View
              width="$iconXl"
              height="$iconXl"
              borderRadius="$pill"
              backgroundColor="$qrForeground"
              alignItems="center"
              justifyContent="center"
            >
              <Icon name={badge} color="$qrBackground" />
            </View>
          </View>
        </View>
      ) : null}
    </Frame>
  );
}

/** A ring of surface around the colored circle, as a fill: the badge reads as sitting on the figure without a border. */
const badgeSizes = {
  sm: { ring: "$iconLg", dot: "$icon" },
  lg: { ring: "$controlSm", dot: "$iconLg" },
} as const;

function DirectionBadge({
  direction,
  size,
}: {
  direction: "in" | "out";
  size: keyof typeof badgeSizes;
}) {
  const { ring, dot } = badgeSizes[size];
  return (
    <View
      width={ring}
      height={ring}
      borderRadius="$pill"
      backgroundColor="$surface"
      alignItems="center"
      justifyContent="center"
    >
      <View
        width={dot}
        height={dot}
        borderRadius="$pill"
        backgroundColor={direction === "out" ? "$warning" : "$accent"}
        alignItems="center"
        justifyContent="center"
      >
        <Icon
          name={direction === "out" ? "ArrowUp" : "ArrowDown"}
          size="sm"
          color="$colorStrong"
        />
      </View>
    </View>
  );
}

export interface SuccessOverlayProps {
  title: string;
  amount?: string | undefined;
  /** Shown after the amount, e.g. "sat". */
  unit?: string | undefined;
  /** Who paid or got paid. */
  detail?: string | undefined;
  /** The other party: their avatar replaces the check mark and their name sits below it. */
  avatar?: { name: string; uri?: string | undefined } | undefined;
  /** Which way the money went, as an arrow badge on the figure. */
  direction?: "in" | "out" | undefined;
  /** The payment is still in flight: a spinner waits where the direction arrow appears once it settles. */
  pending?: boolean | undefined;
  /** Renders in place, filling the nearest positioned parent, instead of portaling over the whole app. */
  contained?: boolean | undefined;
  onDismiss?: (() => void) | undefined;
}

export function SuccessOverlay({
  title,
  amount,
  unit,
  detail,
  avatar,
  direction,
  pending = false,
  contained = false,
  onDismiss,
}: SuccessOverlayProps) {
  const overlay = (
    <Pressable
      position="absolute"
      inset={0}
      zIndex="$overlay"
      cursor="default"
      justifyContent="center"
      padding="$lg"
      backgroundColor="$scrim"
      role="status"
      aria-live="assertive"
      // The portal host turns pointer events off for everything inside it.
      pointerEvents="auto"
      onPress={onDismiss}
    >
      <Stack
        alignItems="center"
        gap="$md"
        width="100%"
        maxWidth="$sheetWidth"
        padding="$xxl"
        borderRadius="$card"
        backgroundColor="$surface"
        boxShadow={shadow.floating}
        transition="slow"
        enterStyle={{ opacity: 0, scale: enterScale.pop }}
      >
        <View position="relative">
          {avatar ? (
            <Avatar name={avatar.name} uri={avatar.uri} size="lg" raised />
          ) : (
            <View
              width="$hero"
              height="$hero"
              borderRadius="$pill"
              backgroundColor={pending ? "$neutralSoft" : "$accentSoft"}
              alignItems="center"
              justifyContent="center"
            >
              {pending ? (
                <Icon
                  name={direction === "in" ? "ArrowDown" : "ArrowUp"}
                  size="xl"
                  color="$warning"
                />
              ) : (
                <Icon name="Check" size="xl" color="$accent" />
              )}
            </View>
          )}
          {/* Keyed so the badges never share an instance: `transition` adds hooks. */}
          {pending ? (
            <View
              key="pending"
              position="absolute"
              right={0}
              bottom={0}
              width="$controlSm"
              height="$controlSm"
              borderRadius="$pill"
              backgroundColor="$surface"
              alignItems="center"
              justifyContent="center"
            >
              <Spinner />
            </View>
          ) : direction ? (
            <View
              key={direction}
              position="absolute"
              right={0}
              bottom={0}
              transition="slow"
              enterStyle={{
                opacity: 0,
                scale: enterScale.pop,
                y: direction === "out" ? space.lg : -space.xxxl,
              }}
            >
              <DirectionBadge direction={direction} size="lg" />
            </View>
          ) : null}
        </View>
        {avatar?.name ? (
          <Text
            variant="label"
            fontWeight="$regular"
            color="$colorMuted"
            textAlign="center"
            numberOfLines={1}
          >
            {avatar.name}
          </Text>
        ) : null}
        <Text variant="heading" textAlign="center">
          {title}
        </Text>
        {amount ? <Amount value={amount} unit={unit} size="md" /> : null}
        {detail ? (
          <Text color="$colorSubtle" textAlign="center">
            {detail}
          </Text>
        ) : null}
      </Stack>
    </Pressable>
  );
  return contained ? overlay : <Portal zIndex="$overlay">{overlay}</Portal>;
}

export interface PaymentBannerProps {
  title: string;
  amount?: string | undefined;
  /** Shown after the amount, e.g. "sat". */
  unit?: string | undefined;
  /** The other party: their avatar replaces the status mark and their name sits under the title. */
  avatar?: { name: string; uri?: string | undefined } | undefined;
  /** Which way the money goes, as an arrow badge on the figure. */
  direction?: "in" | "out" | undefined;
  /** The payment is still in flight: a spinner waits where the direction arrow appears once it settles. */
  pending?: boolean | undefined;
  /** Renders in place, at the top of the nearest positioned parent, instead of portaling over the whole app. */
  contained?: boolean | undefined;
  /** Closes the banner on press or upward swipe; a pending banner cannot be dismissed. */
  onDismiss?: (() => void) | undefined;
}

// Vertical travel before the banner claims the gesture, so taps keep closing it on press.
const BANNER_SWIPE_SLOP = 8;
// Upward travel past which releasing dismisses the banner; a quick flick dismisses sooner.
const BANNER_SWIPE_DISMISS_DISTANCE = 32;
const BANNER_SWIPE_DISMISS_VELOCITY = 0.4;
const BANNER_EXIT_DISTANCE = 120;

const bannerStyles = StyleSheet.create({
  // StyleSheet compiles RN's `box-none` to CSS `pointer-events: none`, letting touches beside the card pass through.
  swipeHost: {
    pointerEvents: "box-none",
    width: "100%",
    alignItems: "center",
  },
});

/**
 * A payment's progress as a card at the top edge: sending, sent or
 * received, with the other party and the amount. Nothing dims the screen
 * and the banner takes only its own touches, so whatever the user was doing
 * goes on underneath.
 */
export function PaymentBanner({
  title,
  amount,
  unit,
  avatar,
  direction,
  pending = false,
  contained = false,
  onDismiss,
}: PaymentBannerProps) {
  const dismiss = pending ? undefined : onDismiss;
  const canDismiss = dismiss !== undefined;
  const [offset] = useState(() => new Animated.Value(0));
  const dismissRef = useRef(dismiss);
  useLayoutEffect(() => {
    dismissRef.current = dismiss;
  }, [dismiss]);
  const mounted = useRef(true);
  const dismissing = useRef(false);
  const swiped = useRef(false);
  // PanResponder zeroes dy when it grants the gesture, so keep the travel that claimed it.
  const claimDy = useRef(0);
  const swipedReset = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const card = useRef<TamaguiElement>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(swipedReset.current);
      offset.stopAnimation();
    };
  }, [offset]);

  // Returning to pending (or dropping onDismiss) cancels any swipe or exit animation in progress.
  useEffect(() => {
    if (canDismiss) return;
    dismissing.current = false;
    swiped.current = false;
    claimDy.current = 0;
    clearTimeout(swipedReset.current);
    swipedReset.current = undefined;
    offset.stopAnimation();
    offset.setValue(0);
  }, [canDismiss, offset]);

  useEffect(() => {
    const node = card.current;
    if (
      !canDismiss ||
      typeof HTMLElement === "undefined" ||
      !(node instanceof HTMLElement)
    ) {
      return;
    }
    const previousTouchAction = node.style.touchAction;
    // Stops mobile browsers from taking an upward swipe as a page scroll.
    node.style.touchAction = "none";
    // Dragging an avatar photo would start browser drag-and-drop and cut the swipe short.
    const keepDragging = (event: DragEvent) => event.preventDefault();
    node.addEventListener("dragstart", keepDragging);
    return () => {
      node.style.touchAction = previousTouchAction;
      node.removeEventListener("dragstart", keepDragging);
    };
  }, [canDismiss]);

  const opacity = useMemo(
    () =>
      offset.interpolate({
        inputRange: [-BANNER_EXIT_DISTANCE, 0],
        outputRange: [0, 1],
        extrapolate: "clamp",
      }),
    [offset],
  );

  const responder = useMemo(() => {
    const isSwipeUp = (state: PanResponderGestureState) => {
      const claimed =
        dismissRef.current !== undefined &&
        !dismissing.current &&
        state.dy < -BANNER_SWIPE_SLOP &&
        Math.abs(state.dy) > Math.abs(state.dx);
      if (claimed) claimDy.current = state.dy;
      return claimed;
    };
    const springBack = () => {
      Animated.spring(offset, {
        toValue: 0,
        speed: 18,
        bounciness: 2,
        useNativeDriver: false,
      }).start();
    };
    const scheduleSwipedReset = () => {
      clearTimeout(swipedReset.current);
      // A touch swipe never clicks, so only a click right after release belongs to the swipe.
      swipedReset.current = setTimeout(() => {
        swiped.current = false;
        swipedReset.current = undefined;
      }, 0);
    };
    // PanResponder stores these callbacks; it does not call them during render.
    // eslint-disable-next-line react-hooks/refs
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_event, state) => isSwipeUp(state),
      onMoveShouldSetPanResponderCapture: (_event, state) => isSwipeUp(state),
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        swiped.current = true;
        offset.stopAnimation();
        offset.setValue(Math.min(0, claimDy.current));
      },
      onPanResponderMove: (_event, state) => {
        offset.setValue(Math.min(0, claimDy.current + state.dy));
      },
      onPanResponderRelease: (_event, state) => {
        scheduleSwipedReset();
        const totalDy = claimDy.current + state.dy;
        claimDy.current = 0;
        const shouldDismiss =
          dismissRef.current !== undefined &&
          (totalDy <= -BANNER_SWIPE_DISMISS_DISTANCE ||
            (totalDy < -BANNER_SWIPE_SLOP &&
              state.vy <= -BANNER_SWIPE_DISMISS_VELOCITY));
        if (!shouldDismiss) {
          springBack();
          return;
        }
        dismissing.current = true;
        Animated.timing(offset, {
          toValue: -BANNER_EXIT_DISTANCE,
          duration: duration.fast,
          useNativeDriver: false,
        }).start(({ finished }) => {
          if (finished && mounted.current && dismissing.current) {
            dismissRef.current?.();
          }
        });
      },
      onPanResponderTerminate: () => {
        claimDy.current = 0;
        clearTimeout(swipedReset.current);
        swipedReset.current = undefined;
        swiped.current = false;
        if (!dismissing.current) springBack();
      },
    });
  }, [offset]);

  const handlePress = () => {
    if (swiped.current) {
      swiped.current = false;
      clearTimeout(swipedReset.current);
      swipedReset.current = undefined;
      return;
    }
    if (dismissing.current) return;
    dismiss?.();
  };

  // React Native Web's PanResponder adds an onClickCapture that blocks taps for 250 ms after release;
  // handlePress already swallows only the swipe's own trailing click.
  const webPanOverride = isWeb ? { onClickCapture: undefined } : {};

  const Frame = dismiss ? Pressable : Row;
  const banner = (
    <View
      position="absolute"
      top={0}
      left={0}
      right={0}
      zIndex="$overlay"
      alignItems="center"
      padding="$md"
      pointerEvents="box-none"
      data-safe-area="top"
    >
      <Animated.View
        {...responder.panHandlers}
        {...webPanOverride}
        style={[
          bannerStyles.swipeHost,
          { transform: [{ translateY: offset }], opacity },
        ]}
      >
        <Frame
          ref={card}
          role="status"
          aria-live="assertive"
          cursor={dismiss ? "pointer" : "default"}
          pointerEvents="auto"
          onPress={dismiss ? handlePress : undefined}
          width="100%"
          maxWidth="$sheetWidth"
          gap="$md"
          alignItems="center"
          paddingVertical="$md"
          paddingHorizontal="$lg"
          borderRadius="$card"
          backgroundColor="$surface"
          boxShadow={shadow.floating}
          transition="slow"
          enterStyle={{ opacity: 0, y: -space.huge }}
        >
          <View position="relative">
            {avatar ? (
              <Avatar name={avatar.name} uri={avatar.uri} size="md" raised />
            ) : (
              <View
                width="$avatar"
                height="$avatar"
                borderRadius="$pill"
                backgroundColor={pending ? "$neutralSoft" : "$accentSoft"}
                alignItems="center"
                justifyContent="center"
              >
                {pending ? (
                  <Icon
                    name={direction === "in" ? "ArrowDown" : "ArrowUp"}
                    size="lg"
                    color="$warning"
                  />
                ) : (
                  <Icon name="Check" size="lg" color="$accent" />
                )}
              </View>
            )}
            {/* Keyed so the badges never share an instance: `transition` adds hooks. */}
            {pending ? (
              <View
                key="pending"
                position="absolute"
                right={-space.xs}
                bottom={-space.xs}
                width="$iconLg"
                height="$iconLg"
                borderRadius="$pill"
                backgroundColor="$surface"
                alignItems="center"
                justifyContent="center"
              >
                <Spinner />
              </View>
            ) : direction ? (
              <View
                key={direction}
                position="absolute"
                right={-space.xs}
                bottom={-space.xs}
                transition="slow"
                enterStyle={{ opacity: 0, scale: enterScale.pop }}
              >
                <DirectionBadge direction={direction} size="sm" />
              </View>
            ) : null}
          </View>
          <Stack flex={1} gap="$none">
            <Text variant="label" numberOfLines={2}>
              {title}
            </Text>
            {avatar?.name ? (
              <Text variant="caption" color="$colorMuted" numberOfLines={1}>
                {avatar.name}
              </Text>
            ) : null}
          </Stack>
          {amount ? (
            <Row gap="$xs" alignItems="baseline" flexShrink={0}>
              <Text
                variant="title"
                color="$colorStrong"
                fontVariant={["tabular-nums"]}
              >
                {amount}
              </Text>
              {unit ? (
                <Text variant="caption" color="$colorMuted">
                  {unit}
                </Text>
              ) : null}
            </Row>
          ) : null}
        </Frame>
      </Animated.View>
    </View>
  );
  return contained ? banner : <Portal zIndex="$overlay">{banner}</Portal>;
}
