import { BackHandler } from "react-native";

type BackPressHandler = () => boolean;

const handlers = new Set<BackPressHandler>();

/**
 * Offers each back press to `handler`, newest handler first, until one
 * returns true: Android's back button, and the iOS edge swipe through
 * `dispatchBackPress`. Returns the unsubscribe.
 */
export const onBackPress = (handler: BackPressHandler): (() => void) => {
  handlers.add(handler);
  const subscription = BackHandler.addEventListener(
    "hardwareBackPress",
    handler,
  );
  return () => {
    handlers.delete(handler);
    subscription.remove();
  };
};

/** Offers a back gesture to the handlers as Android offers its back press; false when none handled it. */
export const dispatchBackPress = (): boolean =>
  [...handlers].reverse().some((handler) => handler());
