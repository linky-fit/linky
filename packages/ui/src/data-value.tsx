import { CodeBlock, Disclosure } from "./diagnostics";
import { Text } from "./layout";

export interface DataValueProps {
  value: string;
  previewLength?: number | undefined;
}

/** A compact value with access to its complete text. */
export function DataValue({ value, previewLength = 40 }: DataValueProps) {
  return value.length > previewLength ? (
    <Disclosure title={value.slice(0, previewLength)}>
      <CodeBlock>{value}</CodeBlock>
    </Disclosure>
  ) : (
    <Text variant="caption" userSelect="text" numberOfLines={1} flexShrink={1}>
      {value}
    </Text>
  );
}
