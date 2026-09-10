import { useId } from "react";
import { Input, Label } from "tamagui";
import type { InputProps } from "tamagui";
import { Icon } from "./icons";
import { IconButton } from "./controls";
import { Row, Stack, Text } from "./layout";
import { GrowingInput } from "./growing-input";

export interface TextFieldProps extends InputProps {
  label: string;
  hint?: string;
  error?: string;
  hideLabel?: boolean;
}
export function TextField({
  label,
  hint,
  error,
  id: suppliedId,
  hideLabel = false,
  ...props
}: TextFieldProps) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  return (
    <Stack gap="$sm">
      {!hideLabel ? (
        <Label
          htmlFor={id}
          fontFamily="$body"
          fontSize={14}
          lineHeight={20}
          color="$subtle"
        >
          {label}
        </Label>
      ) : null}
      <Input
        unstyled
        render={props.multiline ? "textarea" : "input"}
        minHeight="$control"
        minWidth={0}
        backgroundColor="$surface"
        color="$color"
        placeholderTextColor="$placeholderColor"
        borderWidth={1}
        borderColor={error ? "$danger" : "$borderColor"}
        borderRadius="$control"
        paddingHorizontal={14}
        paddingVertical="$md"
        fontFamily="$body"
        fontSize={16}
        lineHeight={24}
        outlineStyle="none"
        focusStyle={{
          borderColor: "$accent",
          outlineWidth: 0,
          outlineStyle: "none",
        }}
        focusVisibleStyle={{ outlineWidth: 0, outlineStyle: "none" }}
        disabledStyle={{ opacity: 0.45 }}
        {...props}
        id={id}
        aria-label={label}
        aria-invalid={Boolean(error)}
        aria-describedby={error || hint ? `${id}-help` : undefined}
      />
      {error || hint ? (
        <Text
          id={`${id}-help`}
          variant="caption"
          color={error ? "$danger" : "$muted"}
          role={error ? "alert" : undefined}
        >
          {error || hint}
        </Text>
      ) : null}
    </Stack>
  );
}
export interface SearchFieldProps {
  label: string;
  placeholder?: string;
  value: string;
  onChangeText: (value: string) => void;
  clearLabel: string;
  disabled?: boolean;
}
export function SearchField({
  label,
  placeholder,
  value,
  onChangeText,
  clearLabel,
  disabled,
}: SearchFieldProps) {
  return (
    <Row
      gap="$sm"
      backgroundColor="$surface"
      borderRadius="$control"
      borderWidth={1}
      borderColor="$borderColor"
      paddingLeft={14}
      focusWithinStyle={{ borderColor: "$accent" }}
    >
      <Icon name="Search" color="$muted" />
      <Input
        unstyled
        flex={1}
        minWidth={0}
        minHeight="$control"
        paddingVertical="$md"
        color="$color"
        fontFamily="$body"
        fontSize={16}
        placeholderTextColor="$placeholderColor"
        aria-label={label}
        placeholder={placeholder ?? label}
        value={value}
        onChangeText={onChangeText}
        disabled={disabled}
        outlineStyle="none"
        focusStyle={{ outlineWidth: 0, outlineStyle: "none" }}
        focusVisibleStyle={{ outlineWidth: 0, outlineStyle: "none" }}
      />
      {value ? (
        <IconButton
          label={clearLabel}
          icon="X"
          onPress={() => onChangeText("")}
          disabled={disabled}
        />
      ) : (
        <Stack width="$sm" />
      )}
    </Row>
  );
}
export interface AmountFieldProps {
  label: string;
  value: string;
  unit: string;
  onChangeText: (value: string) => void;
  hint?: string;
  error?: string;
  disabled?: boolean;
}
export function AmountField({
  label,
  value,
  unit,
  onChangeText,
  hint,
  error,
  disabled,
}: AmountFieldProps) {
  const id = useId();
  return (
    <Stack gap="$sm">
      <Row alignItems="baseline" justifyContent="center" gap="$sm">
        <Stack flex={1} maxWidth={280}>
          <GrowingInput
            unstyled
            aria-label={label}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${id}-error` : undefined}
            minHeight={60}
            fontFamily="$body"
            placeholderTextColor="$placeholderColor"
            borderRadius="$sm"
            focusStyle={{
              outlineWidth: 2,
              outlineColor: "$accent",
              outlineStyle: "solid",
            }}
            value={value}
            onChangeText={onChangeText}
            inputMode="decimal"
            keyboardType="decimal-pad"
            placeholder="0"
            textAlign="right"
            fontSize={48}
            lineHeight={60}
            fontWeight="700"
            color="$accent"
            backgroundColor="$transparent"
            borderWidth={0}
            padding={0}
            disabled={disabled}
          />
        </Stack>
        <Text variant="title" muted fontWeight="400">
          {unit}
        </Text>
      </Row>
      {error ? (
        <Text id={`${id}-error`} variant="caption" color="$danger" role="alert">
          {error}
        </Text>
      ) : null}
      {hint ? (
        <Text variant="label" fontWeight="400" textAlign="center" muted>
          {hint}
        </Text>
      ) : null}
    </Stack>
  );
}
