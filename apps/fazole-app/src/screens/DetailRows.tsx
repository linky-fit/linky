import { Row, Stack, Text } from "@linky-fit/ui";

export interface Detail {
  readonly label: string;
  readonly value: string;
}

/** Label and value pairs, e.g. a payment's variable symbol and account. */
export function DetailRows({
  details,
}: {
  readonly details: readonly Detail[];
}) {
  return (
    <Stack gap="$sm">
      {details.map(({ label, value }) => (
        <Row key={label} justifyContent="space-between" alignItems="flex-start">
          <Text variant="label" fontWeight="$regular" color="$colorMuted">
            {label}
          </Text>
          <Text
            variant="label"
            flexShrink={1}
            textAlign="right"
            fontVariant={["tabular-nums"]}
            aria-label={`${label}: ${value}`}
          >
            {value}
          </Text>
        </Row>
      ))}
    </Stack>
  );
}
