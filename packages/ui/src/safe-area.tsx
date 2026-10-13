import { use, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  Keyboard,
  Platform,
  View,
  type KeyboardEventName,
} from "react-native";
import type { GetProps } from "tamagui";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Stack } from "./layout";
import {
  PageScrollFrameContext,
  type PageScrollFrame,
} from "./page-scroll-frame";
import { zIndex } from "./tokens";

export type SafeAreaPadProps = GetProps<typeof Stack> & {
  /** The screen edge whose device inset pads this stack; none pads nothing. */
  edge?: "top" | "bottom" | undefined;
};

interface Box {
  readonly top: number;
  readonly height: number;
}

/** Where `marker` sits in the frame's content, measured whenever its layout changes. */
const useContentBox = (frame: PageScrollFrame) => {
  const marker = useRef<View>(null);
  const [box, setBox] = useState<Box | null>(null);
  const measure = () => {
    const content = frame.content.current;
    if (content === null) return;
    marker.current?.measureLayout(content, (_left, top, _width, height) =>
      setBox({ top, height }),
    );
  };
  return { marker, box, measure };
};

/**
 * React Native has no sticky boxes: this one moves with the scroll so it
 * stays within the visible part of the scroller once it reaches its edge,
 * the top edge or, for a box placed from the bottom, the bottom one.
 */
function Sticky({
  frame,
  fromBottom,
  children,
}: {
  readonly frame: PageScrollFrame;
  readonly fromBottom: boolean;
  readonly children: ReactNode;
}) {
  const { marker, box, measure } = useContentBox(frame);
  const stuckAt =
    box === null
      ? null
      : fromBottom
        ? box.top + box.height - frame.height
        : box.top;
  const translateY =
    stuckAt === null
      ? 0
      : frame.scrollY.interpolate(
          fromBottom
            ? {
                inputRange: [stuckAt - 1, stuckAt],
                outputRange: [-1, 0],
                extrapolateRight: "clamp",
              }
            : {
                inputRange: [stuckAt, stuckAt + 1],
                outputRange: [0, 1],
                extrapolateLeft: "clamp",
              },
        );
  return (
    <View ref={marker} onLayout={measure} style={{ zIndex: zIndex.sticky }}>
      <Animated.View style={{ transform: [{ translateY }] }}>
        {children}
      </Animated.View>
    </View>
  );
}

/**
 * A layer the size of the scroller's visible part that follows the scroll,
 * for the positioned boxes a web page scroller does not move: the web
 * places them against the page frame around it.
 */
function Pinned({
  frame,
  children,
}: {
  readonly frame: PageScrollFrame;
  readonly children: ReactNode;
}) {
  const { marker, box, measure } = useContentBox(frame);
  return (
    <>
      <View
        ref={marker}
        onLayout={measure}
        pointerEvents="none"
        style={{ position: "absolute", top: 0, left: 0, width: 0, height: 0 }}
      />
      <Animated.View
        pointerEvents="box-none"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: frame.height,
          zIndex: zIndex.sticky,
          transform: [
            { translateY: Animated.subtract(frame.scrollY, box?.top ?? 0) },
          ],
        }}
      >
        {children}
      </Animated.View>
    </>
  );
}

const keyboardEvents: Record<"show" | "hide", KeyboardEventName> =
  Platform.OS === "ios"
    ? { show: "keyboardWillShow", hide: "keyboardWillHide" }
    : { show: "keyboardDidShow", hide: "keyboardDidHide" };

const useKeyboardShown = (watch: boolean): boolean => {
  const [shown, setShown] = useState(() => watch && Keyboard.isVisible());
  useEffect(() => {
    if (!watch) return;
    const subscriptions = [
      Keyboard.addListener(keyboardEvents.show, () => setShown(true)),
      Keyboard.addListener(keyboardEvents.hide, () => setShown(false)),
    ];
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, [watch]);
  return watch && shown;
};

/** A stack padded by the device inset (notch, home indicator) of a screen edge; the keyboard covers the bottom one. */
export function SafeAreaPad({ edge, position, ...props }: SafeAreaPadProps) {
  const insets = useSafeAreaInsets();
  const keyboardShown = useKeyboardShown(edge === "bottom");
  const frame = use(PageScrollFrameContext);
  const padding =
    edge === "top"
      ? { paddingTop: insets.top }
      : edge === "bottom"
        ? { paddingBottom: keyboardShown ? 0 : insets.bottom }
        : {};
  if (position === "sticky") {
    const stack = <Stack {...props} {...padding} position="relative" />;
    return frame === null ? (
      stack
    ) : (
      <Sticky frame={frame} fromBottom={props.bottom !== undefined}>
        {stack}
      </Sticky>
    );
  }
  if (position === "fixed" || (position === "absolute" && frame !== null)) {
    const stack = <Stack {...props} {...padding} position="absolute" />;
    return frame === null ? stack : <Pinned frame={frame}>{stack}</Pinned>;
  }
  return (
    <Stack
      {...props}
      {...padding}
      {...(position === undefined ? {} : { position })}
    />
  );
}
