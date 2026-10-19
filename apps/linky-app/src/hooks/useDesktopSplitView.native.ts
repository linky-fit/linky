import { useWindowDimensions } from "react-native";

// The web app's split view starts at the same width: "(min-width: 961px)".
const DESKTOP_SPLIT_VIEW_MIN_WIDTH = 961;

export const useDesktopSplitView = (): boolean =>
  useWindowDimensions().width >= DESKTOP_SPLIT_VIEW_MIN_WIDTH;
