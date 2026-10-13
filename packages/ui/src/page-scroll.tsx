import { useMemo, useRef, useState } from "react";
import { Animated, type View } from "react-native";
import type { GetProps } from "tamagui";
import { Stack } from "./layout";
import { PageScrollFrameContext } from "./page-scroll-frame";

export type PageScrollProps = GetProps<typeof Stack>;

/** A stack that fills its parent and scrolls its content vertically. */
export function PageScroll({ testID, ...props }: PageScrollProps) {
  const [scrollY] = useState(() => new Animated.Value(0));
  const [height, setHeight] = useState(0);
  const content = useRef<View>(null);
  const frame = useMemo(
    () => ({ scrollY, height, content }),
    [scrollY, height],
  );
  return (
    <Animated.ScrollView
      testID={testID}
      style={{ flex: 1 }}
      contentContainerStyle={{ flexGrow: 1 }}
      keyboardShouldPersistTaps="handled"
      scrollEventThrottle={16}
      onScroll={Animated.event(
        [{ nativeEvent: { contentOffset: { y: scrollY } } }],
        { useNativeDriver: true },
      )}
      onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
    >
      <PageScrollFrameContext value={frame}>
        <Stack ref={content} flexGrow={1} {...props} />
      </PageScrollFrameContext>
    </Animated.ScrollView>
  );
}
