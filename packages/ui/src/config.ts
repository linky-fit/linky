import { Platform } from "react-native";
import { createFont, createTamagui, createTokens } from "tamagui";
import { animations } from "./animations";
import {
  breakpoint,
  COLOR_MODES,
  fontFamily,
  fontWeight,
  palettes,
  radius,
  size,
  space,
  THEME_PALETTES,
  typography,
  zIndex,
} from "./tokens";
import type { ColorMode, ThemePalette } from "./tokens";

/** Premium palettes are sub-themes of the color mode, e.g. `dark_gold`. */
export const themeName = (palette: ThemePalette, mode: ColorMode) =>
  palette === "default" ? mode : `${mode}_${palette}`;

const themes = Object.fromEntries(
  THEME_PALETTES.flatMap((palette) =>
    COLOR_MODES.map((mode) => [
      themeName(palette, mode),
      palettes[palette][mode],
    ]),
  ),
);

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

export const config = createTamagui({
  tokens: createTokens({
    color: { transparent: "transparent" },
    space: withDefault(space, space.lg),
    size: withDefault(size, size.control),
    radius: withDefault(radius, radius.control),
    zIndex: withDefault(zIndex, zIndex.base),
  }),
  themes,
  fonts: { body, mono },
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
