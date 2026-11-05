import { getVariableValue, useTheme } from "tamagui";
import type { ColorTokens } from "tamagui";
import { icons } from "./icon-set";
import type { IconName } from "./icon-set";
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
}

export function Icon({ name, size = "md", color = "$color" }: IconProps) {
  const theme = useTheme();
  const Component = icons[name];
  const themed = theme[color.slice(1)];
  return (
    <Component
      size={iconSizes[size]}
      color={themed ? getVariableValue(themed) : color}
      strokeWidth={iconStroke}
      // An icon keeps its size in a row whose text runs out of room.
      style={{ flexShrink: 0 }}
      aria-hidden
    />
  );
}
