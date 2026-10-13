import {
  useEffect,
  useRef,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";
import type { TextInput } from "react-native";
import { Input, View } from "tamagui";
import { Text } from "./layout";
import { fieldStyle, fieldTrailing } from "./styles";
import { size } from "./tokens";

/** A run of the input's text; an entity run stands out, e.g. a contact or a token. */
export interface RichTextSegment {
  text: string;
  entity?: boolean | undefined;
}

export interface RichTextInputProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "className" | "contentEditable" | "placeholder" | "style"
> {
  placeholder: string;
  /** Shows the placeholder; the caller owns the editable content. */
  empty: boolean;
  disabled?: boolean | undefined;
  /** A small control inside the field's bottom trailing corner, e.g. send; sized for an `sm` IconButton. */
  trailing?: ReactNode;
  ref?: Ref<HTMLDivElement> | undefined;
  /** How iOS and Android control the input; the web caller renders and reads the DOM instead. */
  native?: RichTextInputNative | undefined;
}

export interface RichTextInputNative {
  /** The text, run by run. */
  segments: readonly RichTextSegment[];
  onChangeText: (text: string) => void;
  /** Reports the caret, as a text offset. */
  onCaretChange?: ((caret: number) => void) | undefined;
  /** Moves the caret to this text offset once per new request object. */
  caret?: { readonly at: number } | undefined;
}

/** Native has no contentEditable: a multiline input shows the segments, entities in accent. */
export function RichTextInput({
  placeholder,
  disabled,
  trailing,
  native,
}: RichTextInputProps) {
  const input = useRef<TextInput>(null);
  const caret = native?.caret;
  useEffect(() => {
    if (!caret) return;
    // Android applies the new text after this commit; a selection set before it is lost.
    const frame = requestAnimationFrame(() =>
      input.current?.setSelection(caret.at, caret.at),
    );
    return () => cancelAnimationFrame(frame);
  }, [caret]);
  return (
    <View position="relative">
      <Input
        ref={input}
        unstyled
        {...fieldStyle}
        multiline
        minHeight="$controlLg"
        maxHeight="$column"
        paddingRight={
          trailing ? fieldTrailing.textPadding(size.controlSm) : "$md"
        }
        placeholder={placeholder}
        aria-label={placeholder}
        disabled={disabled}
        {...(native ? { onChangeText: native.onChangeText } : {})}
        onSelectionChange={(event) =>
          native?.onCaretChange?.(event.nativeEvent.selection.end)
        }
      >
        {native?.segments.map((segment, index) =>
          segment.entity ? (
            <Text
              key={index}
              bold
              color="$accentText"
              backgroundColor="$accentSoft"
            >
              {segment.text}
            </Text>
          ) : (
            <Text key={index}>{segment.text}</Text>
          ),
        )}
      </Input>
      {trailing ? (
        <View
          position="absolute"
          right={fieldTrailing.inset}
          bottom={fieldTrailing.inset}
        >
          {trailing}
        </View>
      ) : null}
    </View>
  );
}
