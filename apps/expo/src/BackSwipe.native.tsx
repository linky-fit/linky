import { dispatchBackPress } from "@linky-fit/linky-app/src/platform/appEvents.native";
import type { ReactNode } from "react";
import { Platform, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

const EDGE_WIDTH = 20;
const SWIPE_DISTANCE = 60;
const FLING_VELOCITY = 500;

const edgeSwipe = Gesture.Pan()
  .runOnJS(true)
  .hitSlop({ left: 0, width: EDGE_WIDTH })
  .activeOffsetX(10)
  .failOffsetY([-20, 20])
  .onEnd(({ translationX, velocityX }) => {
    if (translationX > SWIPE_DISTANCE || velocityX > FLING_VELOCITY)
      dispatchBackPress();
  });

/** Walks back, as Android's back press does, on a swipe from the left screen edge on iOS. */
export const BackSwipe = ({ children }: { readonly children: ReactNode }) =>
  Platform.OS === "ios" ? (
    <GestureDetector gesture={edgeSwipe}>
      <View style={{ flex: 1 }}>{children}</View>
    </GestureDetector>
  ) : (
    children
  );
