const palette = {
  white: "#ffffff",
  black: "#000000",
  slate50: "#f8fafc",
  slate100: "#f1f5f9",
  slate200: "#e2e8f0",
  slate300: "#cbd5e1",
  slate400: "#94a3b8",
  slate500: "#64748b",
  slate600: "#475569",
  slate700: "#334155",
  slate800: "#1e293b",
  slate900: "#0f172a",
  slate925: "#0b1222",
  slate950: "#020617",
  teal200: "#99f6e4",
  teal300: "#5eead4",
  teal400: "#2dd4bf",
  teal500: "#14b8a6",
  teal700: "#0f766e",
  teal800: "#115e59",
  teal900: "#134e4a",
  teal950: "#042f2e",
  red200: "#fecaca",
  red400: "#f87171",
  red500: "#ef4444",
  red700: "#b91c1c",
  red800: "#991b1b",
  red950: "#450a0a",
  amber200: "#fde68a",
  amber500: "#f59e0b",
  amber600: "#d97706",
  amber800: "#92400e",
  sky300: "#7dd3fc",
  sky400: "#38bdf8",
  sky500: "#0ea5e9",
  sky600: "#0284c7",
  sky800: "#075985",
  umber50: "#fffaf5",
  umber100: "#f7f0e9",
  umber200: "#e9dbcd",
  umber300: "#d3bcae",
  umber400: "#b59b89",
  umber500: "#8d705b",
  umber600: "#755c4b",
  umber700: "#624c3d",
  umber800: "#392a22",
  umber900: "#2c2019",
  umber925: "#211813",
  umber950: "#160f0c",
  bronze200: "#f1cbaa",
  bronze300: "#edb98f",
  bronze400: "#df9d6e",
  bronze500: "#ca8555",
  bronze700: "#94552f",
  bronze800: "#7c4427",
  bronze900: "#633621",
  pewter50: "#f8fbfd",
  pewter100: "#eff4f7",
  pewter200: "#dce6ed",
  pewter300: "#c0cdd7",
  pewter400: "#9bafbf",
  pewter500: "#6b8497",
  pewter600: "#526b7e",
  pewter700: "#3b5060",
  pewter800: "#2d3b47",
  pewter900: "#1b2832",
  pewter925: "#19222a",
  pewter950: "#10161c",
  steel200: "#d8e8f6",
  steel300: "#bfd6e9",
  steel400: "#a5c2dd",
  steel500: "#88abc9",
  steel700: "#416a8d",
  steel800: "#355874",
  steel900: "#2a455c",
  sand50: "#fffdf4",
  sand100: "#f8f4e7",
  sand200: "#ece4cc",
  sand300: "#d5c8a4",
  sand400: "#b7a77f",
  sand500: "#8e7d53",
  sand600: "#75633e",
  sand700: "#60502f",
  sand800: "#393020",
  sand900: "#2c2515",
  sand925: "#211c10",
  sand950: "#161208",
  gold200: "#f6e8b3",
  gold300: "#efdb93",
  gold400: "#e1c767",
  gold500: "#c5a744",
  gold700: "#8a6508",
  gold800: "#705206",
  gold900: "#5a4205",
  iris50: "#fcfbff",
  iris100: "#f2f1fc",
  iris200: "#e3e2f4",
  iris300: "#cccbe9",
  iris400: "#a9a9ce",
  iris500: "#7e7d9f",
  iris600: "#616083",
  iris700: "#474665",
  iris800: "#30314e",
  iris900: "#23223f",
  iris925: "#1b1b33",
  iris950: "#111022",
  ice200: "#c5eaf8",
  ice300: "#bce9fa",
  ice400: "#96d9f0",
  ice500: "#76bfdc",
  diamond500: "#8583cf",
  diamond700: "#5152a4",
  diamond800: "#42438b",
  diamond900: "#35366f",
};

/** Appends an alpha channel to a 6-digit hex color. */
const alpha = (hex: string, opacity: number) =>
  `${hex}${Math.round(opacity * 255)
    .toString(16)
    .padStart(2, "0")}`;

export const space = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
};

export const radius = {
  none: 0,
  sm: 8,
  control: 12,
  card: 16,
  sheet: 24,
  pill: 999,
};

export const size = {
  none: 0,
  track: 6,
  dot: 10,
  iconSm: 16,
  icon: 20,
  iconLg: 24,
  iconXl: 40,
  controlSm: 32,
  control: 44,
  avatar: 48,
  controlLg: 56,
  row: 64,
  hero: 112,
  column: 160,
  brandHero: 220,
  qr: 240,
  sheetWidth: 520,
  contentWidth: 720,
  appWidth: 1240,
};

export const border = { hairline: 1, emphasis: 2, focus: 3 };

export const iconStroke = 2;

export const letterSpacing = { eyebrow: 1 };

export const opacity = { disabled: 0.5, dimmed: 0.8 };

export const zIndex = {
  base: 0,
  raised: 1,
  sticky: 10,
  overlay: 80,
  toast: 100,
};

export const duration = { fast: 150, base: 220, slow: 420 };

export const easing = {
  standard: "ease-out",
  overshoot: "cubic-bezier(0.2, 0.9, 0.3, 1.2)",
};

export const enterScale = { subtle: 0.96, pop: 0.8 };

export const breakpoint = { wide: 961 };

export const shadow = {
  raised: "0px 4px 12px $shadowColor",
  floating: "0px 16px 40px $shadowColor",
};

export const fontFamily = {
  body: "Manrope, system-ui, sans-serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
};

export const fontWeight = {
  regular: "400",
  semibold: "600",
  bold: "700",
} as const;

export const typography = {
  size: {
    caption: 12,
    label: 14,
    body: 16,
    title: 18,
    heading: 22,
    display: 32,
    amount: 48,
  },
  lineHeight: {
    caption: 16,
    label: 20,
    body: 24,
    title: 24,
    heading: 28,
    display: 40,
    amount: 52,
  },
  weight: {
    caption: "regular",
    label: "semibold",
    body: "regular",
    title: "bold",
    heading: "bold",
    display: "bold",
    amount: "bold",
  },
} as const satisfies {
  size: object;
  lineHeight: object;
  weight: Record<string, keyof typeof fontWeight>;
};

export type TextVariant = keyof typeof typography.size;

const dark = {
  background: palette.slate950,
  backgroundPress: palette.slate800,
  surface: palette.slate925,
  surfaceRaised: palette.slate800,
  // A quiet solid for status marks: dimmer than text, so it reads as "nothing happened".
  neutral: palette.slate500,
  neutralSoft: alpha(palette.slate400, 0.18),
  color: palette.slate200,
  colorStrong: palette.slate50,
  colorSubtle: palette.slate300,
  colorMuted: palette.slate400,
  placeholderColor: palette.slate500,
  borderColor: alpha(palette.slate400, 0.2),
  borderColorHover: alpha(palette.slate400, 0.35),
  outlineColor: alpha(palette.teal500, 0.4),
  shadowColor: alpha(palette.black, 0.4),
  scrim: alpha(palette.slate950, 0.7),
  accent: palette.teal400,
  accentHover: palette.teal300,
  accentPress: palette.teal500,
  onAccent: palette.teal950,
  accentSoft: alpha(palette.teal500, 0.18),
  accentText: palette.teal200,
  danger: palette.red400,
  onDanger: palette.red950,
  dangerSoft: alpha(palette.red500, 0.14),
  dangerText: palette.red200,
  warning: palette.amber500,
  warningSoft: alpha(palette.amber500, 0.16),
  warningText: palette.amber200,
  info: palette.sky400,
  infoSoft: alpha(palette.sky400, 0.16),
  infoText: palette.sky300,
  qrBackground: palette.white,
  qrForeground: palette.slate950,
};

export type ThemeColors = typeof dark;

const light: ThemeColors = {
  background: palette.slate100,
  backgroundPress: palette.slate300,
  surface: palette.white,
  surfaceRaised: palette.slate200,
  neutral: palette.slate400,
  neutralSoft: alpha(palette.slate500, 0.14),
  color: palette.slate900,
  colorStrong: palette.slate950,
  colorSubtle: palette.slate700,
  colorMuted: palette.slate600,
  placeholderColor: palette.slate500,
  borderColor: alpha(palette.slate900, 0.12),
  borderColorHover: alpha(palette.slate900, 0.25),
  outlineColor: alpha(palette.teal500, 0.4),
  shadowColor: alpha(palette.slate900, 0.14),
  scrim: alpha(palette.slate900, 0.4),
  accent: palette.teal700,
  accentHover: palette.teal800,
  accentPress: palette.teal900,
  onAccent: palette.white,
  accentSoft: alpha(palette.teal500, 0.14),
  accentText: palette.teal800,
  danger: palette.red700,
  onDanger: palette.white,
  dangerSoft: alpha(palette.red500, 0.12),
  dangerText: palette.red800,
  warning: palette.amber600,
  warningSoft: alpha(palette.amber500, 0.16),
  warningText: palette.amber800,
  info: palette.sky600,
  infoSoft: alpha(palette.sky500, 0.12),
  infoText: palette.sky800,
  qrBackground: palette.white,
  qrForeground: palette.slate950,
};

const bronzeDark: ThemeColors = {
  ...dark,
  background: palette.umber950,
  backgroundPress: palette.umber800,
  surface: palette.umber925,
  surfaceRaised: palette.umber800,
  neutral: palette.umber500,
  neutralSoft: alpha(palette.umber400, 0.18),
  color: palette.umber200,
  colorStrong: palette.umber50,
  colorSubtle: palette.umber300,
  colorMuted: palette.umber400,
  placeholderColor: palette.umber500,
  borderColor: alpha(palette.umber400, 0.2),
  borderColorHover: alpha(palette.umber400, 0.35),
  outlineColor: alpha(palette.bronze500, 0.4),
  scrim: alpha(palette.umber950, 0.7),
  accent: palette.bronze400,
  accentHover: palette.bronze300,
  accentPress: palette.bronze500,
  onAccent: palette.umber950,
  accentSoft: alpha(palette.bronze500, 0.18),
  accentText: palette.bronze200,
};

const bronzeLight: ThemeColors = {
  ...light,
  background: palette.umber100,
  backgroundPress: palette.umber300,
  surface: palette.umber50,
  surfaceRaised: palette.umber200,
  neutral: palette.umber400,
  neutralSoft: alpha(palette.umber500, 0.14),
  color: palette.umber900,
  colorStrong: palette.umber950,
  colorSubtle: palette.umber700,
  colorMuted: palette.umber600,
  placeholderColor: palette.umber500,
  borderColor: alpha(palette.umber900, 0.12),
  borderColorHover: alpha(palette.umber900, 0.25),
  outlineColor: alpha(palette.bronze500, 0.4),
  shadowColor: alpha(palette.umber900, 0.14),
  scrim: alpha(palette.umber900, 0.4),
  accent: palette.bronze700,
  accentHover: palette.bronze800,
  accentPress: palette.bronze900,
  accentSoft: alpha(palette.bronze500, 0.14),
  accentText: palette.bronze800,
};

const silverDark: ThemeColors = {
  ...dark,
  background: palette.pewter950,
  backgroundPress: palette.pewter800,
  surface: palette.pewter925,
  surfaceRaised: palette.pewter800,
  neutral: palette.pewter500,
  neutralSoft: alpha(palette.pewter400, 0.18),
  color: palette.pewter200,
  colorStrong: palette.pewter50,
  colorSubtle: palette.pewter300,
  colorMuted: palette.pewter400,
  placeholderColor: palette.pewter500,
  borderColor: alpha(palette.pewter400, 0.2),
  borderColorHover: alpha(palette.pewter400, 0.35),
  outlineColor: alpha(palette.steel500, 0.4),
  scrim: alpha(palette.pewter950, 0.7),
  accent: palette.steel400,
  accentHover: palette.steel300,
  accentPress: palette.steel500,
  onAccent: palette.pewter950,
  accentSoft: alpha(palette.steel500, 0.18),
  accentText: palette.steel200,
};

const silverLight: ThemeColors = {
  ...light,
  background: palette.pewter100,
  backgroundPress: palette.pewter300,
  surface: palette.pewter50,
  surfaceRaised: palette.pewter200,
  neutral: palette.pewter400,
  neutralSoft: alpha(palette.pewter500, 0.14),
  color: palette.pewter900,
  colorStrong: palette.pewter950,
  colorSubtle: palette.pewter700,
  colorMuted: palette.pewter600,
  placeholderColor: palette.pewter500,
  borderColor: alpha(palette.pewter900, 0.12),
  borderColorHover: alpha(palette.pewter900, 0.25),
  outlineColor: alpha(palette.steel500, 0.4),
  shadowColor: alpha(palette.pewter900, 0.14),
  scrim: alpha(palette.pewter900, 0.4),
  accent: palette.steel700,
  accentHover: palette.steel800,
  accentPress: palette.steel900,
  accentSoft: alpha(palette.steel500, 0.14),
  accentText: palette.steel800,
};

const goldDark: ThemeColors = {
  ...dark,
  background: palette.sand950,
  backgroundPress: palette.sand800,
  surface: palette.sand925,
  surfaceRaised: palette.sand800,
  neutral: palette.sand500,
  neutralSoft: alpha(palette.sand400, 0.18),
  color: palette.sand200,
  colorStrong: palette.sand50,
  colorSubtle: palette.sand300,
  colorMuted: palette.sand400,
  placeholderColor: palette.sand500,
  borderColor: alpha(palette.sand400, 0.2),
  borderColorHover: alpha(palette.sand400, 0.35),
  outlineColor: alpha(palette.gold500, 0.4),
  scrim: alpha(palette.sand950, 0.7),
  accent: palette.gold400,
  accentHover: palette.gold300,
  accentPress: palette.gold500,
  onAccent: palette.sand950,
  accentSoft: alpha(palette.gold500, 0.18),
  accentText: palette.gold200,
  warning: palette.amber600,
};

const goldLight: ThemeColors = {
  ...light,
  background: palette.sand100,
  backgroundPress: palette.sand300,
  surface: palette.sand50,
  surfaceRaised: palette.sand200,
  neutral: palette.sand400,
  neutralSoft: alpha(palette.sand500, 0.14),
  color: palette.sand900,
  colorStrong: palette.sand950,
  colorSubtle: palette.sand700,
  colorMuted: palette.sand600,
  placeholderColor: palette.sand500,
  borderColor: alpha(palette.sand900, 0.12),
  borderColorHover: alpha(palette.sand900, 0.25),
  outlineColor: alpha(palette.gold500, 0.4),
  shadowColor: alpha(palette.sand900, 0.14),
  scrim: alpha(palette.sand900, 0.4),
  accent: palette.gold700,
  accentHover: palette.gold800,
  accentPress: palette.gold900,
  accentSoft: alpha(palette.gold500, 0.14),
  accentText: palette.gold800,
};

const diamondDark: ThemeColors = {
  ...dark,
  background: palette.iris950,
  backgroundPress: palette.iris800,
  surface: palette.iris925,
  surfaceRaised: palette.iris800,
  neutral: palette.iris500,
  neutralSoft: alpha(palette.iris400, 0.18),
  color: palette.iris200,
  colorStrong: palette.iris50,
  colorSubtle: palette.iris300,
  colorMuted: palette.iris400,
  placeholderColor: palette.iris500,
  borderColor: alpha(palette.iris400, 0.2),
  borderColorHover: alpha(palette.iris400, 0.35),
  outlineColor: alpha(palette.ice500, 0.4),
  scrim: alpha(palette.iris950, 0.7),
  accent: palette.ice400,
  accentHover: palette.ice300,
  accentPress: palette.ice500,
  onAccent: palette.iris950,
  accentSoft: alpha(palette.ice500, 0.18),
  accentText: palette.ice200,
};

const diamondLight: ThemeColors = {
  ...light,
  background: palette.iris100,
  backgroundPress: palette.iris300,
  surface: palette.iris50,
  surfaceRaised: palette.iris200,
  neutral: palette.iris400,
  neutralSoft: alpha(palette.iris500, 0.14),
  color: palette.iris900,
  colorStrong: palette.iris950,
  colorSubtle: palette.iris700,
  colorMuted: palette.iris600,
  placeholderColor: palette.iris500,
  borderColor: alpha(palette.iris900, 0.12),
  borderColorHover: alpha(palette.iris900, 0.25),
  outlineColor: alpha(palette.diamond500, 0.4),
  shadowColor: alpha(palette.iris900, 0.14),
  scrim: alpha(palette.iris900, 0.4),
  accent: palette.diamond700,
  accentHover: palette.diamond800,
  accentPress: palette.diamond900,
  accentSoft: alpha(palette.diamond500, 0.14),
  accentText: palette.diamond800,
};

export type ColorMode = "dark" | "light";

export const COLOR_MODES = ["dark", "light"] as const satisfies ColorMode[];

/** Default is free; each supporter tier unlocks the palette of the same name. */
export const THEME_PALETTES = [
  "default",
  "bronze",
  "silver",
  "gold",
  "diamond",
] as const;

export type ThemePalette = (typeof THEME_PALETTES)[number];

/** The colors of every palette in both color modes. */
export const palettes: Record<ThemePalette, Record<ColorMode, ThemeColors>> = {
  default: { dark, light },
  bronze: { dark: bronzeDark, light: bronzeLight },
  silver: { dark: silverDark, light: silverLight },
  gold: { dark: goldDark, light: goldLight },
  diamond: { dark: diamondDark, light: diamondLight },
};

/** The generic badge shows support without revealing the tier. */
export const SUPPORTER_BADGE_KINDS = [
  "bronze",
  "silver",
  "gold",
  "diamond",
  "generic",
] as const;

export type SupporterBadgeKind = (typeof SUPPORTER_BADGE_KINDS)[number];

export interface SupporterBadgeColors {
  base: string;
  /** The rim, so the coin stands out on light and dark pages. */
  shade: string;
  glyph: string;
}

export const supporterBadgeColors: Record<
  SupporterBadgeKind,
  SupporterBadgeColors
> = {
  bronze: { base: "#b87333", shade: "#925726", glyph: "#29180b" },
  silver: { base: "#cbd5e1", shade: "#94a3b8", glyph: "#334155" },
  gold: { base: "#e9b949", shade: "#c99628", glyph: "#49320b" },
  diamond: { base: "#a5e4f4", shade: "#66bed4", glyph: "#164e63" },
  generic: { base: "#14b8a6", shade: "#0f9488", glyph: "#083d38" },
};

export type Tone = "neutral" | "accent" | "warning" | "danger" | "info";
