import type { ReactNode } from "react";
import { Slider, Button as TamaguiButton, View } from "tamagui";
import type { ColorTokens, GetProps } from "tamagui";
import { Icon } from "./icons";
import type { IconName, IconSize } from "./icons";
import { Row, Stack, Text } from "./layout";
import { Spinner } from "./spinner";
import { focusRing, tooltipProps } from "./styles";
import { opacity, size as sizes } from "./tokens";

export type PressableProps = GetProps<typeof TamaguiButton> & {
  /** A browser tooltip on the web; ignored on native. */
  tooltip?: string | undefined;
};

/** An unstyled, focusable press target; every pressable in the library builds on it. */
export function Pressable({ disabled, tooltip, ...props }: PressableProps) {
  return (
    <TamaguiButton
      unstyled
      // Unlike its default JSX element, a string element gets the native `disabled`, which also blocks keys and form submits.
      render="button"
      type="button"
      flexDirection="row"
      alignItems="center"
      cursor="pointer"
      backgroundColor="$transparent"
      borderWidth={0}
      padding="$none"
      focusVisibleStyle={focusRing}
      disabledStyle={{ opacity: opacity.disabled, cursor: "default" }}
      disabled={disabled}
      // Tamagui's disabled button ignores the pointer, which would hide its tooltip.
      pointerEvents="auto"
      {...tooltipProps(tooltip)}
      {...props}
    />
  );
}

/** A labelled callback, rendered as a button by the component that takes it. */
export interface LabeledAction {
  label: string;
  onPress: () => void;
}

const buttonVariants = {
  primary: {
    background: "$accent",
    hover: "$accentHover",
    press: "$accentPress",
    color: "$onAccent",
  },
  secondary: {
    background: "$surfaceRaised",
    hover: "$backgroundPress",
    press: "$backgroundPress",
    color: "$color",
  },
  ghost: {
    background: "$transparent",
    hover: "$neutralSoft",
    press: "$neutralSoft",
    color: "$colorSubtle",
  },
  accent: {
    background: "$accentSoft",
    hover: "$accentSoft",
    press: "$accentSoft",
    color: "$accentText",
  },
  danger: {
    background: "$danger",
    hover: "$danger",
    press: "$danger",
    color: "$onDanger",
  },
} satisfies Record<
  string,
  {
    background: ColorTokens;
    hover: ColorTokens;
    press: ColorTokens;
    color: ColorTokens;
  }
>;

export type ButtonVariant = keyof typeof buttonVariants;

export interface ButtonProps extends Omit<
  PressableProps,
  "children" | "icon" | "size" | "variant"
> {
  children?: ReactNode;
  variant?: ButtonVariant | undefined;
  size?: "sm" | "md" | undefined;
  icon?: IconName | undefined;
  loading?: boolean | undefined;
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  icon,
  loading = false,
  disabled,
  ...props
}: ButtonProps) {
  const colors = buttonVariants[variant];
  const small = size === "sm";
  return (
    <Pressable
      justifyContent="center"
      gap="$sm"
      minHeight={small ? "$controlSm" : "$control"}
      paddingHorizontal={small ? "$md" : "$lg"}
      paddingVertical={small ? "$xs" : "$md"}
      borderRadius={small ? "$pill" : "$control"}
      backgroundColor={colors.background}
      hoverStyle={{ backgroundColor: colors.hover }}
      pressStyle={{ backgroundColor: colors.press, opacity: opacity.dimmed }}
      disabled={disabled || loading}
      aria-busy={loading}
      {...props}
    >
      {loading ? (
        <Spinner color={colors.color} />
      ) : icon ? (
        <Icon name={icon} color={colors.color} />
      ) : null}
      {typeof children === "string" || typeof children === "number" ? (
        <Text
          variant={small ? "caption" : "label"}
          bold
          color={colors.color}
          textAlign="center"
          numberOfLines={1}
        >
          {children}
        </Text>
      ) : (
        children
      )}
    </Pressable>
  );
}

export interface IconButtonProps extends Omit<
  ButtonProps,
  "children" | "icon" | "size" | "aria-label"
> {
  icon: IconName;
  accessibilityLabel: string;
  size?: "sm" | "md" | "lg" | undefined;
}

const iconButtonSizes = {
  sm: { box: "$controlSm", icon: "sm" },
  md: { box: "$control", icon: "md" },
  lg: { box: "$controlLg", icon: "lg" },
} as const satisfies Record<string, { box: `$${string}`; icon: IconSize }>;

export function IconButton({
  icon,
  accessibilityLabel,
  variant = "ghost",
  size = "md",
  loading = false,
  disabled,
  ...props
}: IconButtonProps) {
  const colors = buttonVariants[variant];
  const dimensions = iconButtonSizes[size];
  const color = variant === "ghost" ? "$color" : colors.color;
  return (
    <Pressable
      aria-label={accessibilityLabel}
      justifyContent="center"
      width={dimensions.box}
      height={dimensions.box}
      flexShrink={0}
      borderRadius="$pill"
      backgroundColor={colors.background}
      hoverStyle={{ backgroundColor: colors.hover }}
      pressStyle={{ backgroundColor: colors.press, opacity: opacity.dimmed }}
      disabled={disabled || loading}
      aria-busy={loading}
      {...props}
    >
      {loading ? (
        <Spinner color={color} />
      ) : (
        <Icon name={icon} size={dimensions.icon} color={color} />
      )}
    </Pressable>
  );
}

export interface SwitchProps {
  accessibilityLabel: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean | undefined;
}

export function Switch({
  accessibilityLabel,
  value,
  onValueChange,
  disabled,
}: SwitchProps) {
  return (
    <Pressable
      role="switch"
      aria-checked={value}
      aria-label={accessibilityLabel}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      width="$control"
      height="$iconLg"
      flexShrink={0}
      paddingHorizontal="$xxs"
      borderRadius="$pill"
      justifyContent={value ? "flex-end" : "flex-start"}
      backgroundColor={value ? "$accentSoft" : "$neutralSoft"}
    >
      <View
        width="$icon"
        height="$icon"
        borderRadius="$pill"
        backgroundColor={value ? "$accentText" : "$colorSubtle"}
      />
    </Pressable>
  );
}

export interface ChipProps {
  label: string;
  selected?: boolean | undefined;
  onPress: () => void;
  disabled?: boolean | undefined;
  accessibilityLabel?: string | undefined;
}

/** A selectable pill: filters, reactions and choices. */
export function Chip({
  label,
  selected = false,
  onPress,
  disabled,
  accessibilityLabel,
}: ChipProps) {
  return (
    <Pressable
      aria-pressed={selected}
      aria-label={accessibilityLabel}
      onPress={onPress}
      disabled={disabled}
      gap="$xs"
      minHeight="$controlSm"
      paddingHorizontal="$md"
      borderRadius="$pill"
      backgroundColor={selected ? "$accentSoft" : "$neutralSoft"}
      hoverStyle={{ opacity: opacity.dimmed }}
    >
      <Text
        variant="caption"
        bold
        color={selected ? "$accentText" : "$colorSubtle"}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export interface OptionTileProps extends Omit<
  PressableProps,
  "children" | "icon"
> {
  label: string;
  /** A large icon above the label; use `leading` for anything else, e.g. an avatar. */
  icon?: IconName | undefined;
  leading?: ReactNode;
  selected?: boolean | undefined;
  /** Shown below the label, e.g. a caption. */
  children?: ReactNode;
}

/** A selectable tile in a row or grid of choices: a picture above a short label. */
export function OptionTile({
  label,
  icon,
  leading,
  selected = false,
  children,
  ...props
}: OptionTileProps) {
  return (
    <Pressable
      aria-pressed={selected}
      flexDirection="column"
      justifyContent="center"
      gap="$xs"
      paddingVertical="$md"
      paddingHorizontal="$sm"
      borderRadius="$card"
      backgroundColor={selected ? "$accentSoft" : "$surface"}
      hoverStyle={{ opacity: opacity.dimmed }}
      {...props}
    >
      {icon ? <Icon name={icon} size="lg" /> : leading}
      <Text variant="caption" bold textAlign="center" numberOfLines={2}>
        {label}
      </Text>
      {children}
    </Pressable>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean | undefined;
}

export interface SegmentedControlProps<T extends string> {
  accessibilityLabel: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onValueChange: (value: T) => void;
}

export function SegmentedControl<T extends string>({
  accessibilityLabel,
  value,
  options,
  onValueChange,
}: SegmentedControlProps<T>) {
  return (
    <Row
      role="radiogroup"
      aria-label={accessibilityLabel}
      gap="$xs"
      padding="$xs"
      borderRadius="$pill"
      backgroundColor="$neutralSoft"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            role="radio"
            aria-checked={selected}
            disabled={option.disabled}
            onPress={() => onValueChange(option.value)}
            flex={1}
            justifyContent="center"
            minHeight="$controlSm"
            paddingHorizontal="$md"
            borderRadius="$pill"
            backgroundColor={selected ? "$accent" : "$transparent"}
          >
            <Text
              variant="caption"
              bold
              color={selected ? "$onAccent" : "$colorSubtle"}
              numberOfLines={1}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </Row>
  );
}

export interface StepperProps {
  accessibilityLabel: string;
  value: number;
  valueText?: string | undefined;
  min: number;
  max: number;
  step?: number | undefined;
  onValueChange: (value: number) => void;
  decreaseLabel: string;
  increaseLabel: string;
  disabled?: boolean | undefined;
}

export function Stepper({
  accessibilityLabel,
  value,
  valueText,
  min,
  max,
  step = 1,
  onValueChange,
  decreaseLabel,
  increaseLabel,
  disabled,
}: StepperProps) {
  return (
    <Row
      role="group"
      aria-label={accessibilityLabel}
      alignSelf="flex-start"
      gap="$xs"
      padding="$xxs"
      borderRadius="$pill"
      backgroundColor="$neutralSoft"
    >
      <IconButton
        icon="Minus"
        accessibilityLabel={decreaseLabel}
        size="sm"
        variant="secondary"
        disabled={disabled || value <= min}
        onPress={() => onValueChange(Math.max(min, value - step))}
      />
      <Text
        variant="label"
        bold
        minWidth="$controlSm"
        textAlign="center"
        aria-live="polite"
      >
        {valueText ?? value}
      </Text>
      <IconButton
        icon="Plus"
        accessibilityLabel={increaseLabel}
        size="sm"
        variant="secondary"
        disabled={disabled || value >= max}
        onPress={() => onValueChange(Math.min(max, value + step))}
      />
    </Row>
  );
}

export interface SliderFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number | undefined;
  onValueChange: (value: number) => void;
  disabled?: boolean | undefined;
}

export function SliderField({
  label,
  value,
  min,
  max,
  step = 1,
  onValueChange,
  disabled = false,
}: SliderFieldProps) {
  return (
    <Stack gap="$sm">
      <Text variant="label" color="$colorSubtle">
        {label}
      </Text>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={([next]) => {
          if (next !== undefined) onValueChange(next);
        }}
        height="$iconLg"
      >
        <Slider.Track
          height="$track"
          marginTop={(sizes.iconLg - sizes.track) / 2}
          borderRadius="$pill"
          backgroundColor="$neutralSoft"
        >
          <Slider.TrackActive backgroundColor="$accent" />
        </Slider.Track>
        <Slider.Thumb
          unstyled
          index={0}
          size="$icon"
          circular
          position="absolute"
          aria-label={label}
          backgroundColor="$accent"
          hoverStyle={{ backgroundColor: "$accentHover" }}
          pressStyle={{ backgroundColor: "$accentPress" }}
          focusVisibleStyle={focusRing}
        />
      </Slider>
    </Stack>
  );
}
