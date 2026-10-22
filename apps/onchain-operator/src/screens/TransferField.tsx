import { IconButton, Row, Stack, Text, TextLink } from "@linky-fit/ui";
import { copy } from "../copy/en";
import { copyText } from "../platform/clipboard";

/** A labelled value the operator may copy, with an explorer link where there is one. */
export function TransferField({
  label,
  value,
  href,
}: {
  readonly label: string;
  readonly value: string;
  readonly href?: string | undefined;
}) {
  return (
    <Stack gap="$xxs">
      <Text variant="caption" color="$colorMuted">
        {label}
      </Text>
      <Row gap="$sm">
        <Text variant="label" mono flex={1} minWidth={0} userSelect="text">
          {value}
        </Text>
        <IconButton
          icon="Copy"
          size="sm"
          accessibilityLabel={`${copy.transfer.copy} ${label}`}
          onPress={() => void copyText(value)}
        />
      </Row>
      {href === undefined ? null : (
        <TextLink href={href}>{copy.transfer.viewInExplorer}</TextLink>
      )}
    </Stack>
  );
}
