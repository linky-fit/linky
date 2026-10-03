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
  device: 48,
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
  device: 300,
  brandHero: 220,
  qr: 240,
  sheetWidth: 520,
  contentWidth: 720,
  appWidth: 1240,
};

export const border = { hairline: 1, emphasis: 2, focus: 3 };

export const iconStroke = 2;

export const letterSpacing = { eyebrow: 1, headline: -2 };

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
    headline: 80,
  },
  lineHeight: {
    caption: 16,
    label: 20,
    body: 24,
    title: 24,
    heading: 28,
    display: 40,
    amount: 52,
    headline: 84,
  },
  weight: {
    caption: "regular",
    label: "semibold",
    body: "regular",
    title: "bold",
    heading: "bold",
    display: "bold",
    amount: "bold",
    headline: "bold",
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
  bezel: palette.slate800,
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
  bezel: palette.slate950,
};

export const themes = { dark, light };

export type ColorMode = keyof typeof themes;

export type Tone = "neutral" | "accent" | "warning" | "danger" | "info";
