import Svg, { Circle, Path } from "react-native-svg";
import type { SupporterBadgeColors, SupporterBadgeKind } from "./tokens";
import { size as sizes, supporterBadgeColors } from "./tokens";

// The same artwork as the badge images on linky.fit/badges.
const star =
  "M11.55 5.05Q12 4.15 12.45 5.05L14.4 9L18.75 9.63Q19.75 9.78 19.03 10.48L15.88 13.55L16.62 17.88Q16.79 18.88 15.89 18.4L12 16.35L8.11 18.4Q7.21 18.88 7.38 17.88L8.12 13.55L4.97 10.48Q4.25 9.78 5.25 9.63L9.6 9Z";

const glyphs: Record<
  SupporterBadgeKind,
  readonly { d: string; fill: keyof SupporterBadgeColors }[]
> = {
  bronze: [{ d: star, fill: "glyph" }],
  silver: [{ d: star, fill: "glyph" }],
  gold: [{ d: star, fill: "glyph" }],
  diamond: [
    { d: "M8 5.8H16L19.2 10.2L12 18.6L4.8 10.2Z", fill: "glyph" },
    { d: "M8.4 10.2H15.6L12 15.8Z", fill: "shade" },
  ],
  generic: [
    {
      d: "M12 8.2C10.1 5.8 6.4 5.6 5.1 8.1C3.6 11.1 6.1 13.7 11.3 18C11.7 18.33 12.3 18.33 12.7 18C17.9 13.7 20.4 11.1 18.9 8.1C17.6 5.6 13.9 5.8 12 8.2Z",
      fill: "glyph",
    },
  ],
};

export interface SupporterBadgeProps {
  kind: SupporterBadgeKind;
  size?: keyof typeof sizes | undefined;
  /** Leave it out when text beside the badge already names it. */
  accessibilityLabel?: string | undefined;
}

/** The coin a supporter shows: the tier's metal, or the generic Supporter heart. */
export function SupporterBadge({
  kind,
  size = "iconLg",
  accessibilityLabel,
}: SupporterBadgeProps) {
  const colors = supporterBadgeColors[kind];
  const width = sizes[size];
  return (
    <Svg
      width={width}
      height={width}
      viewBox="0 0 24 24"
      role={accessibilityLabel ? "img" : undefined}
      aria-label={accessibilityLabel}
      aria-hidden={!accessibilityLabel}
    >
      <Circle
        cx={12}
        cy={12}
        r={11.4}
        fill={colors.base}
        stroke={colors.shade}
        strokeWidth={1.2}
      />
      {glyphs[kind].map(({ d, fill }) => (
        <Path key={d} d={d} fill={colors[fill]} />
      ))}
    </Svg>
  );
}
