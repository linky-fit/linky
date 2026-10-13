import { useId, useState } from "react";
import type { ComponentRef, ReactNode, Ref } from "react";
import { Input, Label } from "tamagui";
import type { GetProps } from "tamagui";
import { Row, Stack, Text } from "./layout";
import { fieldStyle, fieldTrailing, textVariant } from "./styles";
import { opacity, size } from "./tokens";

interface FieldFrameProps {
  id: string;
  label: string;
  hideLabel?: boolean | undefined;
  hint?: string | undefined;
  error?: string | undefined;
  disabled?: boolean | undefined;
  children: ReactNode;
}

export function FieldFrame({
  id,
  label,
  hideLabel,
  hint,
  error,
  disabled,
  children,
}: FieldFrameProps) {
  return (
    <Stack gap="$xs" opacity={disabled ? opacity.disabled : 1}>
      {hideLabel ? null : (
        <Label
          unstyled
          htmlFor={id}
          fontFamily="$body"
          {...textVariant("label")}
          color="$colorSubtle"
        >
          {label}
        </Label>
      )}
      {children}
      {error || hint ? (
        <Text
          id={`${id}-description`}
          variant="caption"
          color={error ? "$dangerText" : "$colorMuted"}
          role={error ? "alert" : undefined}
        >
          {error || hint}
        </Text>
      ) : null}
    </Stack>
  );
}

const fieldA11y = (
  id: string,
  label: string,
  error: string | undefined,
  hint: string | undefined,
  invalid = false,
) =>
  ({
    id,
    "aria-label": label,
    "aria-invalid": Boolean(error) || invalid,
    "aria-describedby": error || hint ? `${id}-description` : undefined,
    borderColor: error || invalid ? "$danger" : "$transparent",
  }) as const;

export interface TextFieldProps extends Omit<GetProps<typeof Input>, "size"> {
  label: string;
  hideLabel?: boolean | undefined;
  hint?: string | undefined;
  error?: string | undefined;
  /** Marks the field invalid without its own message, for a grid of fields whose problems one shared line explains. */
  invalid?: boolean | undefined;
  /** Sits inside the field at its end, e.g. an `sm` IconButton to clear or paste; a string is a muted suffix such as a unit. */
  trailing?: ReactNode;
  ref?: Ref<ComponentRef<typeof Input>> | undefined;
}

export function TextField({
  label,
  hideLabel,
  hint,
  error,
  invalid = false,
  trailing,
  id,
  disabled,
  multiline = false,
  ...props
}: TextFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const [trailingWidth, setTrailingWidth] = useState<number>(size.controlSm);
  return (
    <FieldFrame
      id={fieldId}
      label={label}
      hideLabel={hideLabel}
      hint={hint}
      error={error}
      disabled={disabled}
    >
      {/* Always wrapped, so a trailing element that comes and goes never remounts the focused input. */}
      <Stack position="relative">
        <Input
          unstyled
          {...fieldStyle}
          {...fieldA11y(fieldId, label, error, hint, invalid)}
          disabled={disabled}
          multiline={multiline}
          {...(multiline ? { rows: 4, whiteSpace: "pre-wrap" } : {})}
          paddingRight={
            trailing ? fieldTrailing.textPadding(trailingWidth) : "$md"
          }
          // Tamagui drops `spellCheck` on the web and renders `multiline` as a single-line input; the render element fixes both.
          render={
            multiline ? (
              <textarea spellCheck={props.spellCheck} />
            ) : (
              <input spellCheck={props.spellCheck} />
            )
          }
          {...props}
        />
        {trailing ? (
          <Row
            position="absolute"
            right={fieldTrailing.inset}
            {...(multiline
              ? { bottom: fieldTrailing.inset }
              : { top: 0, bottom: 0 })}
            maxWidth="50%"
            onLayout={(event) =>
              setTrailingWidth(event.nativeEvent.layout.width)
            }
          >
            {typeof trailing === "string" ? (
              <Text
                variant="caption"
                color="$colorMuted"
                numberOfLines={1}
                flexShrink={1}
              >
                {trailing}
              </Text>
            ) : (
              trailing
            )}
          </Row>
        ) : null}
      </Stack>
    </FieldFrame>
  );
}
