import { Row, Text } from "@linky-fit/ui";

interface SeedWordGridProps {
  words: ReadonlyArray<string>;
  /** False masks every word. */
  visible: boolean;
}

/** Backup words in numbered tiles, two to a row. */
export const SeedWordGrid = ({ words, visible }: SeedWordGridProps) => (
  <Row flexWrap="wrap" gap="$sm" aria-live="polite">
    {words.map((word, index) => (
      <Row
        key={index}
        flexBasis="40%"
        flexGrow={1}
        paddingHorizontal="$md"
        paddingVertical="$sm"
        borderRadius="$control"
        backgroundColor="$neutralSoft"
        gap="$sm"
      >
        <Text variant="caption" color="$colorMuted">
          {index + 1}
        </Text>
        <Text
          mono
          variant="label"
          color={visible ? "$colorStrong" : "$colorMuted"}
        >
          {visible ? word : "****"}
        </Text>
      </Row>
    ))}
  </Row>
);
