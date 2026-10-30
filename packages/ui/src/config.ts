import { Platform } from "react-native";
import { createFont, createTamagui, createTokens } from "tamagui";
import { animations } from "./animations";
import {
  breakpoint,
  fontFamily,
  fontWeight,
  radius,
  size,
  space,
  themes,
  typography,
  zIndex,
} from "./tokens";

const withDefault = <T extends Record<string, number | string>>(
  scale: T,
  fallback: T[keyof T],
) => ({
  ...scale,
  true: fallback,
});

const fontScale = {
  size: withDefault(typography.size, typography.size.body),
  lineHeight: withDefault(typography.lineHeight, typography.lineHeight.body),
  weight: withDefault(fontWeight, fontWeight.regular),
};

const body = createFont({
  ...fontScale,
  family: Platform.OS === "web" ? fontFamily.body : "Manrope",
  // Native has no weight axis: each weight is its own family, named after @expo-google-fonts/manrope.
  face: {
    400: { normal: "Manrope_400Regular" },
    600: { normal: "Manrope_600SemiBold" },
    700: { normal: "Manrope_700Bold" },
  },
});

const mono = createFont({
  ...fontScale,
  family: Platform.select({
    web: fontFamily.mono,
    ios: "Menlo",
    default: "monospace",
  }),
});

const handwriting = createFont({
  ...fontScale,
  family: Platform.select({ web: fontFamily.handwriting, default: "cursive" }),
});

export const config = createTamagui({
  tokens: createTokens({
    color: { transparent: "transparent" },
    space: withDefault(space, space.lg),
    size: withDefault(size, size.control),
    radius: withDefault(radius, radius.control),
    zIndex: withDefault(zIndex, zIndex.base),
  }),
  themes,
  fonts: { body, mono, handwriting },
  animations,
  media: {
    compact: { maxWidth: breakpoint.wide - 1 },
    wide: { minWidth: breakpoint.wide },
  },
  settings: {
    defaultFont: "body",
    disableSSR: true,
    allowedStyleValues: { color: "strict", space: "strict", size: "percent" },
  },
});

type LinkyConfig = typeof config;

declare module "tamagui" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- Tamagui reads the app config through declaration merging.
  interface TamaguiCustomConfig extends LinkyConfig {}
}
