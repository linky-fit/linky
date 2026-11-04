import { useState } from "react";
import { getVariableValue, useTheme } from "tamagui";
import type { RichTextInputProps } from "./rich-text-input";
import {
  duration,
  easing,
  fontFamily,
  opacity,
  radius,
  size,
  space,
  typography,
} from "./tokens";

// Centers an `sm` control in a one-line field.
const trailingInset = (size.control - size.controlSm) / 2;

/** A contentEditable host: the caller renders and reads its DOM content. */
export function RichTextInput({
  placeholder,
  empty,
  disabled = false,
  trailing,
  ref,
  onFocus,
  onBlur,
  ...props
}: RichTextInputProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const text = {
    paddingBlock: (size.control - typography.lineHeight.body) / 2,
    paddingInline: space.lg,
    paddingRight: trailing ? size.controlSm + 2 * trailingInset : space.lg,
    fontFamily: fontFamily.body,
    fontSize: typography.size.body,
    lineHeight: `${typography.lineHeight.body}px`,
  };
  return (
    <div style={{ position: "relative", minWidth: 0 }}>
      <div
        {...props}
        ref={ref}
        role="textbox"
        aria-multiline
        aria-label={placeholder}
        aria-disabled={disabled}
        contentEditable={!disabled}
        suppressContentEditableWarning
        tabIndex={disabled ? -1 : 0}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={{
          ...text,
          minHeight: size.control,
          maxHeight: size.column,
          overflowY: "auto",
          overflowWrap: "anywhere",
          whiteSpace: "pre-wrap",
          borderRadius: radius.sheet,
          border: "none",
          boxSizing: "border-box",
          // Focus shows as a lighter fill, never as an outline around the filled field.
          background: getVariableValue(
            focused ? theme.surfaceRaised : theme.surface,
          ),
          transition: `background ${duration.fast}ms ${easing.standard}`,
          color: getVariableValue(theme.color),
          outline: "none",
          cursor: disabled ? "not-allowed" : "text",
          opacity: disabled ? opacity.disabled : 1,
        }}
      />
      {empty ? (
        <span
          aria-hidden
          style={{
            ...text,
            position: "absolute",
            inset: 0,
            color: getVariableValue(theme.placeholderColor),
            pointerEvents: "none",
          }}
        >
          {placeholder}
        </span>
      ) : null}
      {trailing ? (
        <div
          style={{
            position: "absolute",
            right: trailingInset,
            bottom: trailingInset,
          }}
        >
          {trailing}
        </div>
      ) : null}
    </div>
  );
}
