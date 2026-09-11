import { useState } from "react";
import { Input } from "tamagui";
import type { InputProps } from "tamagui";

export interface GrowingInputProps extends Omit<
  InputProps,
  "height" | "minHeight" | "maxHeight" | "value" | "onContentSizeChange"
> {
  value: string;
  minHeight: number;
  maxHeight?: number;
}
export function GrowingInput({
  minHeight,
  maxHeight,
  ...props
}: GrowingInputProps) {
  const [contentHeight, setContentHeight] = useState(minHeight);
  return (
    <Input
      {...props}
      render="textarea"
      multiline
      minHeight={minHeight}
      height={Math.min(
        maxHeight ?? Infinity,
        Math.max(minHeight, contentHeight),
      )}
      onContentSizeChange={(event) =>
        setContentHeight(event.nativeEvent.contentSize.height)
      }
      scrollEnabled={maxHeight !== undefined}
    />
  );
}
