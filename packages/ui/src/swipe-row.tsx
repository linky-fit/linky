import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Animated, PanResponder } from "react-native";
import type {
  GestureResponderEvent,
  PanResponderGestureState,
} from "react-native";
import { View } from "tamagui";
import type { TamaguiElement } from "tamagui";
import { Icon } from "./icons";
import type { IconName } from "./icons";
import { Text } from "./layout";
import { toneColors } from "./styles";
import { duration, space } from "./tokens";
import type { Tone } from "./tokens";

export interface SwipeAction {
  icon: IconName;
  label: string;
  tone: Tone;
  onTrigger: () => void;
}

export interface SwipeRowProps {
  /** Shown on the row's end when it is swiped to the left. */
  swipeLeft?: SwipeAction | undefined;
  /** Shown on the row's start when it is swiped to the right. */
  swipeRight?: SwipeAction | undefined;
  /** Usually one `ListRow`; a press still opens it unless the row moved or stands open. */
  children: ReactNode;
  testID?: string | undefined;
}

/** How wide the action stands open after a short swipe. */
export const swipeRevealWidth = 88;
// Horizontal travel before the row takes the gesture, so taps and vertical scrolls stay with the content.
const SWIPE_SLOP = 10;
// The row's width until it is measured.
const DEFAULT_WIDTH = 360;
// A pause in trackpad scrolling this long ends a two-finger swipe, momentum included.
const WHEEL_END_MS = 120;
// Steps in a row each smaller than the one before that mark macOS momentum, i.e. the fingers lifted.
const MOMENTUM_STEPS = 3;

type Side = "left" | "right";

// The gap between the action tile and the row it slides out from.
const TILE_GAP = space.sm;

interface Gesture {
  move: (dx: number) => void;
  release: (dx: number) => void;
  close: () => void;
  runOpen: () => void;
}

// The one row standing open or being swiped; swiping another closes it, as no pointer press does for a trackpad.
let activeRow: Gesture | null = null;

// Set while the momentum of an ended trackpad swipe still arrives. It is swallowed wherever the pointer now is, so a row that moved under it after the action, e.g. a listing just pinned, does not take it for a swipe of its own.
let momentumEnd: ReturnType<typeof setTimeout> | undefined;
const awaitMomentumEnd = () => {
  clearTimeout(momentumEnd);
  momentumEnd = setTimeout(() => {
    momentumEnd = undefined;
  }, WHEEL_END_MS);
};

/**
 * Where the row sits after the pointer moved `dx`: it follows at first, then
 * resists more and more, never passing 60 % of the row's `width`.
 */
const swipeTravel = (dx: number, width: number): number => {
  const limit = 0.6 * width;
  return Math.sign(dx) * limit * (1 - Math.exp(-Math.abs(dx) / limit));
};

/** The pointer movement that puts the row at `travel`; the inverse of `swipeTravel`. */
const swipeDistance = (travel: number, width: number): number => {
  const limit = 0.6 * width;
  return -Math.sign(travel) * limit * Math.log(1 - Math.abs(travel) / limit);
};

/** The travel past which letting go runs the action instead of leaving it open; well beyond the open width, within the limit. */
const swipeTriggerTravel = (width: number): number =>
  Math.min(Math.max(0.4 * width, 1.5 * swipeRevealWidth), 0.5 * width);

const isHorizontal = (gesture: PanResponderGestureState) =>
  Math.abs(gesture.dx) > SWIPE_SLOP &&
  Math.abs(gesture.dx) > 2 * Math.abs(gesture.dy);

const restingTravel = (side: Side | null) =>
  side === "left" ? -swipeRevealWidth : side === "right" ? swipeRevealWidth : 0;

/**
 * A list row with an action on either side, e.g. hiding or pinning an item.
 * A short swipe leaves the action standing open to be pressed; pulling on,
 * well past it, runs it on release. The gesture has no keyboard or screen
 * reader equivalent, so every action must also be reachable elsewhere, e.g.
 * on the item's detail.
 */
export function SwipeRow({
  swipeLeft,
  swipeRight,
  children,
  testID,
}: SwipeRowProps) {
  const [offset] = useState(() => new Animated.Value(0));
  const [iconScale] = useState(() => new Animated.Value(1));
  const [revealed, setRevealed] = useState<Side | null>(null);
  const [open, setOpen] = useState<Side | null>(null);
  const [armed, setArmed] = useState(false);
  const width = useRef(DEFAULT_WIDTH);
  const actions = useRef({ left: swipeLeft, right: swipeRight });
  useLayoutEffect(() => {
    actions.current = { left: swipeLeft, right: swipeRight };
  }, [swipeLeft, swipeRight]);
  const swiped = useRef(false);
  // The side standing open, for the event listeners; `open` renders it.
  const openSide = useRef<Side | null>(null);
  const frame = useRef<TamaguiElement>(null);
  const actionArea = useRef<TamaguiElement>(null);

  // The pointer and the trackpad drive one gesture: `move` while it lasts, `release` at its end, both relative to where the row rests.
  const gesture = useMemo((): Gesture => {
    const sideOf = (total: number): Side | null => {
      const side = total < 0 ? "left" : total > 0 ? "right" : null;
      return side && actions.current[side] ? side : null;
    };
    const travelOf = (total: number) =>
      sideOf(total) ? swipeTravel(total, width.current) : 0;
    const triggers = (total: number) =>
      Math.abs(travelOf(total)) >= swipeTriggerTravel(width.current);
    const totalOf = (dx: number) =>
      swipeDistance(restingTravel(openSide.current), width.current) + dx;
    const settle = (side: Side | null) => {
      if (side) activeRow = self;
      else if (activeRow === self) activeRow = null;
      openSide.current = side;
      setOpen(side);
      setArmed(false);
      if (side) setRevealed(side);
      Animated.spring(offset, {
        toValue: restingTravel(side),
        speed: 18,
        bounciness: 2,
        useNativeDriver: false,
      }).start(({ finished }) => {
        // A swipe that caught the row on its way keeps what it revealed.
        if (finished && !openSide.current) setRevealed(null);
      });
    };
    const self: Gesture = {
      move: (dx: number) => {
        if (activeRow !== self) {
          activeRow?.close();
          activeRow = self;
        }
        const total = totalOf(dx);
        offset.setValue(travelOf(total));
        setRevealed(sideOf(total));
        setArmed(triggers(total));
      },
      release: (dx: number) => {
        const total = totalOf(dx);
        const side = sideOf(total);
        if (side && triggers(total)) {
          settle(null);
          actions.current[side]?.onTrigger();
        } else {
          const standsOpen = Math.abs(travelOf(total)) >= swipeRevealWidth / 2;
          settle(side && standsOpen ? side : null);
        }
      },
      close: () => settle(null),
      runOpen: () => {
        const side = openSide.current;
        settle(null);
        if (side) actions.current[side]?.onTrigger();
      },
    };
    return self;
  }, [offset]);

  useEffect(
    () => () => {
      if (activeRow === gesture) activeRow = null;
    },
    [gesture],
  );

  // The tile spans from the row's edge to the gap before the moving content.
  const tileWidth = useMemo(
    () => ({
      right: offset.interpolate({
        inputRange: [TILE_GAP, TILE_GAP + 1],
        outputRange: [0, 1],
        extrapolateLeft: "clamp",
        extrapolateRight: "extend",
      }),
      left: offset.interpolate({
        inputRange: [-TILE_GAP - 1, -TILE_GAP],
        outputRange: [1, 0],
        extrapolateLeft: "extend",
        extrapolateRight: "clamp",
      }),
    }),
    [offset],
  );

  // The icon pops when the swipe crosses the point of running the action, so letting go is felt to matter.
  useEffect(() => {
    if (!armed) return;
    Animated.sequence([
      Animated.timing(iconScale, {
        toValue: 1.3,
        duration: duration.fast,
        useNativeDriver: false,
      }),
      Animated.spring(iconScale, { toValue: 1, useNativeDriver: false }),
    ]).start();
  }, [armed, iconScale]);

  useEffect(() => {
    const node = frame.current;
    if (typeof HTMLElement === "undefined" || !(node instanceof HTMLElement))
      return;
    // A mouse drag ends in a click on the row underneath, and a press on a row standing open only closes it; neither opens the item.
    const swallow = (event: MouseEvent) => {
      const onAction =
        actionArea.current instanceof Node &&
        event.target instanceof Node &&
        actionArea.current.contains(event.target);
      if (swiped.current) {
        swiped.current = false;
      } else if (openSide.current && !onAction) {
        gesture.close();
      } else {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    // A two-finger trackpad swipe arrives as horizontal wheel events, without a start or an end of its own.
    let wheelDx = 0;
    let wheelEnd: ReturnType<typeof setTimeout> | undefined;
    let lastStep = 0;
    let slowing = 0;
    const resetWheel = () => {
      clearTimeout(wheelEnd);
      wheelDx = 0;
      wheelEnd = undefined;
      lastStep = 0;
      slowing = 0;
    };
    const wheel = (event: WheelEvent) => {
      if (momentumEnd !== undefined) {
        event.preventDefault();
        awaitMomentumEnd();
        return;
      }
      const sideways = Math.abs(event.deltaX) > Math.abs(event.deltaY);
      if (wheelEnd === undefined && !sideways) return;
      // Keeps the browser from scrolling the page or going back in history.
      event.preventDefault();
      clearTimeout(wheelEnd);
      wheelEnd = setTimeout(() => {
        gesture.release(wheelDx);
        resetWheel();
      }, WHEEL_END_MS);
      const step = -(event.deltaMode === 1 ? event.deltaX * 16 : event.deltaX);
      wheelDx += step;
      slowing =
        Math.sign(step) === Math.sign(lastStep) &&
        Math.abs(step) < Math.abs(lastStep)
          ? slowing + 1
          : 0;
      lastStep = step;
      // Momentum would carry the row on after the fingers lifted, so the swipe ends where it starts.
      if (slowing >= MOMENTUM_STEPS) {
        const dx = wheelDx;
        resetWheel();
        awaitMomentumEnd();
        gesture.release(dx);
        return;
      }
      gesture.move(wheelDx);
    };
    // Dragging a photo in the row would start the browser's own drag and drop, which ends the swipe.
    const keepDragging = (event: DragEvent) => event.preventDefault();
    node.addEventListener("click", swallow, true);
    node.addEventListener("wheel", wheel, { passive: false });
    node.addEventListener("dragstart", keepDragging);
    return () => {
      clearTimeout(wheelEnd);
      node.removeEventListener("click", swallow, true);
      node.removeEventListener("wheel", wheel);
      node.removeEventListener("dragstart", keepDragging);
    };
  }, [gesture]);

  // A row standing open closes when the user turns to anything else, another row included.
  useEffect(() => {
    const node = frame.current;
    if (!open || !(node instanceof Node)) return;
    const closeOutside = (event: Event) => {
      if (event.target instanceof Node && !node.contains(event.target))
        gesture.close();
    };
    document.addEventListener("pointerdown", closeOutside, true);
    return () =>
      document.removeEventListener("pointerdown", closeOutside, true);
  }, [open, gesture]);

  const responder = useMemo(
    () =>
      // PanResponder stores these callbacks; it does not call them during render.
      // eslint-disable-next-line react-hooks/refs
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, state) => isHorizontal(state),
        onMoveShouldSetPanResponderCapture: (_event, state) =>
          isHorizontal(state),
        onPanResponderGrant: () => {
          swiped.current = true;
        },
        onPanResponderMove: (
          _event: GestureResponderEvent,
          state: PanResponderGestureState,
        ) => gesture.move(state.dx),
        onPanResponderRelease: (_event, state) => {
          gesture.release(state.dx);
          // A touch swipe never clicks, so only a click right after the release is the swipe's own.
          setTimeout(() => {
            swiped.current = false;
          }, 0);
        },
        onPanResponderTerminate: () => {
          swiped.current = false;
          gesture.release(0);
        },
      }),
    [gesture],
  );

  const action = revealed
    ? revealed === "left"
      ? swipeLeft
      : swipeRight
    : null;
  const foreground = armed
    ? "$background"
    : action && toneColors[action.tone].color;
  return (
    <View
      ref={frame}
      testID={testID}
      position="relative"
      overflow="hidden"
      marginHorizontal={-space.md}
      onLayout={(event) => {
        width.current = event.nativeEvent.layout.width || DEFAULT_WIDTH;
      }}
    >
      {revealed && action && foreground ? (
        <Animated.View
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            [revealed === "left" ? "right" : "left"]: 0,
            width: tileWidth[revealed],
          }}
        >
          <View
            ref={actionArea}
            flex={1}
            overflow="hidden"
            borderRadius="$control"
            flexDirection="row"
            alignItems="center"
            // Stretched past the point of running, the action keeps beside the row, as if pulled along.
            justifyContent={
              armed
                ? revealed === "left"
                  ? "flex-start"
                  : "flex-end"
                : "center"
            }
            // Once letting go runs the action, the colors swap.
            backgroundColor={
              armed
                ? toneColors[action.tone].color
                : toneColors[action.tone].background
            }
            cursor={open ? "pointer" : undefined}
            onPress={open ? gesture.runOpen : undefined}
            aria-hidden
          >
            <View
              width={swipeRevealWidth - TILE_GAP}
              flexShrink={0}
              alignItems="center"
              gap="$xxs"
            >
              <Animated.View style={{ transform: [{ scale: iconScale }] }}>
                <Icon name={action.icon} size="sm" color={foreground} />
              </Animated.View>
              <Text variant="caption" color={foreground} numberOfLines={1}>
                {action.label}
              </Text>
            </View>
          </View>
        </Animated.View>
      ) : null}
      <Animated.View
        {...responder.panHandlers}
        style={{ transform: [{ translateX: offset }] }}
      >
        <View paddingHorizontal="$md">{children}</View>
      </Animated.View>
    </View>
  );
}
