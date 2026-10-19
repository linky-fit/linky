import { useEffect, useMemo, useRef, useState, type Ref } from "react";
import {
  Animated,
  type ScrollView as ScrollViewRef,
  type View,
} from "react-native";
import type { GetProps, TamaguiElement } from "tamagui";
import { ScrollView } from "tamagui";
import { Stack } from "./layout";
import {
  PageScrollFrameContext,
  registerPageScroll,
} from "./page-scroll-frame";

export type PageScrollProps = GetProps<typeof Stack>;

/** A stack that fills its parent and scrolls its content vertically. */
export function PageScroll({ testID, ...props }: PageScrollProps) {
  const [scrollY] = useState(() => new Animated.Value(0));
  const [height, setHeight] = useState(0);
  const scroll = useRef<ScrollViewRef>(null);
  const content = useRef<View>(null);
  const visibleHeight = useRef(0);
  const frame = useMemo(
    () => ({ scrollY, height, content }),
    [scrollY, height],
  );
  useEffect(
    () => registerPageScroll({ scroll, content, height: visibleHeight }),
    [],
  );
  return (
    <Animated.ScrollView
      ref={scroll}
      testID={testID}
      style={{ flex: 1 }}
      contentContainerStyle={{ flexGrow: 1 }}
      keyboardShouldPersistTaps="handled"
      scrollEventThrottle={16}
      onScroll={Animated.event(
        [{ nativeEvent: { contentOffset: { y: scrollY } } }],
        { useNativeDriver: true },
      )}
      onLayout={(event) => {
        visibleHeight.current = event.nativeEvent.layout.height;
        setHeight(event.nativeEvent.layout.height);
      }}
    >
      <PageScrollFrameContext value={frame}>
        <Stack ref={content} flexGrow={1} {...props} />
      </PageScrollFrameContext>
    </Animated.ScrollView>
  );
}

export type LogScrollProps = PageScrollProps & {
  ref?: Ref<TamaguiElement> | undefined;
};

const END_SLACK_PX = 48;

/** A stack that fills its parent and scrolls vertically, following new content at its end while scrolled there, e.g. a chat log. */
export function LogScroll({ testID, ref, ...props }: LogScrollProps) {
  const scrollRef = useRef<ScrollViewRef>(null);
  const atEnd = useRef(true);
  const keepEndInView = () => {
    if (atEnd.current) scrollRef.current?.scrollToEnd({ animated: false });
  };
  return (
    <ScrollView
      ref={scrollRef}
      testID={testID}
      flex={1}
      keyboardShouldPersistTaps="handled"
      scrollEventThrottle={64}
      onScroll={({ nativeEvent }) => {
        const { contentOffset, contentSize, layoutMeasurement } = nativeEvent;
        atEnd.current =
          contentOffset.y + layoutMeasurement.height >=
          contentSize.height - END_SLACK_PX;
      }}
      onContentSizeChange={keepEndInView}
      // A shrinking viewport, e.g. the keyboard opening, moves the end out of view without a scroll.
      onLayout={keepEndInView}
    >
      <Stack ref={ref} {...props} />
    </ScrollView>
  );
}
