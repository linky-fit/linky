import { Text } from "./layout";
import type { DataValueProps } from "./data-value";

export type { DataValueProps } from "./data-value";

/** Keeps the full value in the browser tooltip while the cell stays compact. */
export function DataValue({ value, previewLength = 40 }: DataValueProps) {
  return (
    <Text
      variant="caption"
      userSelect="text"
      numberOfLines={1}
      flexShrink={1}
      {...{ title: value }}
    >
      {value.slice(0, previewLength)}
    </Text>
  );
}
