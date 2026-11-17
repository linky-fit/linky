import { View, getVariableValue, useTheme } from "tamagui";
import type { ColorTokens } from "tamagui";
import { icons } from "./icon-set";
import type { IconName } from "./icon-set";
import { tooltipProps } from "./styles";
import { iconStroke, size } from "./tokens";

export type { IconName };

const iconSizes = {
  sm: size.iconSm,
  md: size.icon,
  lg: size.iconLg,
  xl: size.iconXl,
};

export type IconSize = keyof typeof iconSizes;

export interface IconProps {
  name: IconName;
  size?: IconSize | undefined;
  color?: ColorTokens | undefined;
  /** Names a standalone icon that carries meaning: its accessibility label and, on the web, its tooltip. */
  tooltip?: string | undefined;
}

export function Icon({
  name,
  size = "md",
  color = "$color",
  tooltip,
}: IconProps) {
  const theme = useTheme();
  const Component = icons[name];
  const themed = theme[color.slice(1)];
  const glyph = (
    <Component
      size={iconSizes[size]}
      color={themed ? getVariableValue(themed) : color}
      strokeWidth={iconStroke}
      // An icon keeps its size in a row whose text runs out of room.
      style={{ flexShrink: 0 }}
      aria-hidden
    />
  );
  if (tooltip === undefined) return glyph;
  return (
    <View
      role="img"
      aria-label={tooltip}
      flexShrink={0}
      {...tooltipProps(tooltip)}
    >
      {glyph}
    </View>
  );
}
