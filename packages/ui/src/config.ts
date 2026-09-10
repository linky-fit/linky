import { createFont, createTamagui, createTokens } from "tamagui";
import {
  palette,
  themes,
  space,
  size,
  radius,
  zIndex,
  breakpoints,
} from "./tokens";

const font = createFont({
  family: "Manrope",
  size: { 1: 12, 2: 14, 3: 16, 4: 20, 5: 28, 6: 40, 7: 48, true: 16 },
  lineHeight: { 1: 16, 2: 20, 3: 24, 4: 28, 5: 36, 6: 48, 7: 56, true: 24 },
  weight: { 1: "400", 2: "600", 3: "700", true: "400" },
  face: {
    400: { normal: "Manrope" },
    600: { normal: "ManropeSemiBold" },
    700: { normal: "ManropeBold" },
  },
});
export const config = createTamagui({
  tokens: createTokens({
    color: palette,
    space: {
      0: 0,
      1: 4,
      2: 8,
      3: 12,
      4: 16,
      5: 20,
      6: 24,
      7: 32,
      8: 48,
      true: 16,
      ...space,
    },
    size: { 0: 0, 1: 20, 2: 32, 3: 44, 4: 48, 5: 64, true: 48, ...size },
    radius: { 0: 0, 1: 8, 2: 12, 3: 16, 4: 999, true: 12, ...radius },
    zIndex: { 0: 0, 1: 10, 2: 100, true: 0, ...zIndex },
  }),
  themes,
  fonts: { body: font, heading: font },
  media: {
    compact: { maxWidth: breakpoints.wide - 1 },
    wide: { minWidth: breakpoints.wide },
  },
  settings: { defaultFont: "body" },
});
type LinkyNextConfig = typeof config;
declare module "tamagui" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- Tamagui registers config through declaration merging.
  interface TamaguiCustomConfig extends LinkyNextConfig {}
}
