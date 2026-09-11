import { Children, type ReactNode } from "react";
import { Button as TamaguiButton, Spinner } from "tamagui";
import type { ButtonProps as TamaguiButtonProps, ColorTokens } from "tamagui";
import { Icon } from "./icons";
import type { IconName } from "./icons";
import { Row, Text } from "./layout";

export interface ButtonProps extends Omit<
  TamaguiButtonProps,
  "icon" | "size" | "variant" | "color"
> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "regular" | "small";
  icon?: IconName;
  loading?: boolean;
  loadingLabel?: string;
  color?: ColorTokens;
}
const variants = {
  primary: {
    backgroundColor: "$accent",
    color: "$onAccent",
    hoverStyle: { backgroundColor: "$accentHover" },
    pressStyle: { backgroundColor: "$accentPress" },
  },
  secondary: {
    backgroundColor: "$surfaceRaised",
    color: "$color",
    hoverStyle: { backgroundColor: "$borderColor" },
  },
  ghost: {
    backgroundColor: "$transparent",
    color: "$color",
    hoverStyle: { backgroundColor: "$backgroundHover" },
  },
  danger: {
    backgroundColor: "$danger",
    color: "$onDanger",
    hoverStyle: { backgroundColor: "$dangerHover" },
  },
} satisfies Record<string, TamaguiButtonProps>;
export function Button({
  children,
  variant = "primary",
  size = "regular",
  icon,
  loading = false,
  loadingLabel,
  disabled,
  ...props
}: ButtonProps) {
  const colors = variants[variant];
  return (
    <TamaguiButton
      unstyled
      render="button"
      type="button"
      minHeight={size === "small" ? 44 : 48}
      paddingHorizontal="$md"
      paddingVertical="$sm"
      gap="$md"
      flexDirection="row"
      alignItems="center"
      justifyContent="center"
      borderWidth={0}
      borderRadius="$control"
      fontFamily="$body"
      fontSize={size === "small" ? 14 : 16}
      fontWeight="600"
      ellipsis={false}
      textProps={{ whiteSpace: "normal", flexShrink: 1 }}
      cursor="pointer"
      {...colors}
      focusVisibleStyle={{
        outlineColor: "$accent",
        outlineWidth: 2,
        outlineOffset: 4,
        outlineStyle: "solid",
      }}
      disabledStyle={{ opacity: 0.45, cursor: "not-allowed" }}
      {...props}
      disabled={disabled || loading}
      aria-busy={loading}
    >
      {loading ? (
        <Spinner size="small" color={props.color ?? colors.color} />
      ) : icon ? (
        <Icon name={icon} color={props.color ?? colors.color} />
      ) : null}
      {loading && loadingLabel
        ? loadingLabel
        : Children.map(children, (child) =>
            typeof child === "number" || typeof child === "bigint"
              ? String(child)
              : child,
          )}
    </TamaguiButton>
  );
}
export interface IconButtonProps extends Omit<
  ButtonProps,
  "children" | "icon"
> {
  label: string;
  icon: IconName;
  iconSize?: number;
}
export function IconButton({
  label,
  icon,
  variant = "ghost",
  iconSize = 22,
  color,
  ...props
}: IconButtonProps) {
  return (
    <Button
      variant={variant}
      size="small"
      width={44}
      minWidth={44}
      height={44}
      padding={10}
      aria-label={label}
      color={color ?? variants[variant].color}
      {...props}
    >
      {!props.loading ? (
        <Icon
          name={icon}
          size={iconSize}
          color={color ?? variants[variant].color}
        />
      ) : null}
    </Button>
  );
}
export interface ChipProps {
  children: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  onPress: () => void;
}
export function Chip({
  children,
  selected = false,
  disabled,
  onPress,
}: ChipProps) {
  return (
    <Button
      variant="ghost"
      size="small"
      borderRadius="$pill"
      paddingHorizontal="$lg"
      backgroundColor={selected ? "$accentSoft" : "$surface"}
      color={selected ? "$accent" : "$muted"}
      aria-pressed={selected}
      disabled={disabled}
      onPress={onPress}
    >
      {children}
    </Button>
  );
}
export interface Segment {
  value: string;
  label: string;
  disabled?: boolean;
}
export interface SegmentedControlProps {
  label: string;
  value: string;
  options: readonly Segment[];
  onValueChange: (value: string) => void;
}
export function SegmentedControl({
  label,
  value,
  options,
  onValueChange,
}: SegmentedControlProps) {
  return (
    <Row
      role="group"
      aria-label={label}
      backgroundColor="$surface"
      borderRadius="$control"
      padding="$xs"
      gap="$xs"
      flexWrap="wrap"
    >
      {options.map((option) => (
        <Button
          key={option.value}
          variant="ghost"
          size="small"
          flex={1}
          backgroundColor={
            value === option.value ? "$surfaceRaised" : "$transparent"
          }
          aria-pressed={value === option.value}
          disabled={option.disabled}
          onPress={() => onValueChange(option.value)}
        >
          <Text
            variant="label"
            color={value === option.value ? "$color" : "$muted"}
          >
            {option.label}
          </Text>
        </Button>
      ))}
    </Row>
  );
}
