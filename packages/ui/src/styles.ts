import { isWeb } from "tamagui";
import type { ColorTokens } from "tamagui";
import type { IconName } from "./icons";
import type { TextVariant, Tone } from "./tokens";
import { border, space, typography } from "./tokens";

export const focusRing = {
  outlineColor: "$outlineColor",
  outlineWidth: border.focus,
  outlineStyle: "solid",
} as const;

/** A browser tooltip; native has no hover, so it gets nothing. */
export const tooltipProps = (tooltip: string | undefined) =>
  isWeb && tooltip !== undefined ? { title: tooltip } : {};

export const textVariant = (variant: TextVariant) =>
  ({
    fontSize: `$${variant}`,
    lineHeight: `$${variant}`,
    fontWeight: `$${typography.weight[variant]}`,
  }) as const;

export const toneColors: Record<
  Tone,
  { background: ColorTokens; color: ColorTokens; solid: ColorTokens }
> = {
  neutral: {
    background: "$neutralSoft",
    color: "$colorSubtle",
    solid: "$neutral",
  },
  accent: { background: "$accentSoft", color: "$accentText", solid: "$accent" },
  warning: {
    background: "$warningSoft",
    color: "$warningText",
    solid: "$warning",
  },
  danger: { background: "$dangerSoft", color: "$dangerText", solid: "$danger" },
  info: { background: "$infoSoft", color: "$infoText", solid: "$info" },
};

export const toneIcons: Record<Tone, IconName> = {
  neutral: "Info",
  accent: "Check",
  warning: "TriangleAlert",
  danger: "CircleAlert",
  info: "Info",
};

/** Places a small action inside a field: `inset` from its end (and bottom when multiline), with text padding that keeps the field's text clear of an action `width` wide. */
export const fieldTrailing = {
  inset: space.md,
  textPadding: (width: number) => width + 2 * space.md,
};

export const fieldStyle = {
  minHeight: "$control",
  paddingHorizontal: "$md",
  paddingVertical: "$md",
  borderRadius: "$control",
  borderWidth: border.hairline,
  borderColor: "$transparent",
  backgroundColor: "$neutralSoft",
  color: "$color",
  placeholderTextColor: "$placeholderColor",
  fontFamily: "$body",
  ...textVariant("body"),
  focusStyle: focusRing,
} as const;
