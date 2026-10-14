import { Icon, Row, Stack, Text, useMedia } from "@linky-fit/ui";
import { copy } from "../copy";
import type { ComparisonRow } from "../copy";
import { Reveal, SectionHeading, SiteSection } from "./parts";
import { sectionIds } from "./sectionIds";

const comparison = copy.comparison;

function Cell({ text, ours }: { text: string; ours: boolean }) {
  return (
    <Row
      flex={1}
      flexBasis={0}
      gap="$sm"
      alignItems="flex-start"
      padding="$lg"
      borderRadius="$control"
      backgroundColor={ours ? "$accentSoft" : "$transparent"}
    >
      <Icon
        name={ours ? "Check" : "X"}
        size="sm"
        color={ours ? "$accentText" : "$colorMuted"}
      />
      <Text
        flex={1}
        variant="label"
        fontWeight={ours ? "$bold" : "$regular"}
        color={ours ? "$colorStrong" : "$colorMuted"}
      >
        {text}
      </Text>
    </Row>
  );
}

function TableRow({ row }: { row: ComparisonRow }) {
  const { wide } = useMedia();
  const cells = (
    <>
      <Cell text={row.cardTerminal} ours={false} />
      <Cell text={row.fazole} ours />
    </>
  );
  return (
    <Stack
      role="row"
      gap="$xs"
      padding="$xs"
      borderRadius="$card"
      backgroundColor="$surface"
    >
      {wide ? (
        <Row gap="$xs" alignItems="stretch">
          <Text
            flex={1}
            flexBasis={0}
            alignSelf="center"
            paddingHorizontal="$lg"
            fontWeight="$semibold"
            color="$colorStrong"
          >
            {row.label}
          </Text>
          {cells}
        </Row>
      ) : (
        <>
          <Text eyebrow paddingHorizontal="$lg" paddingTop="$md">
            {row.label}
          </Text>
          <Row gap="$xs" alignItems="stretch">
            {cells}
          </Row>
        </>
      )}
    </Stack>
  );
}

export function Comparison() {
  const { wide } = useMedia();
  return (
    <SiteSection id={sectionIds.comparison}>
      <Reveal>
        <SectionHeading
          eyebrow={comparison.eyebrow}
          title={comparison.title}
          body={comparison.body}
        />
      </Reveal>
      <Reveal>
        <Stack gap="$sm">
          <Row role="row" gap="$xs" paddingHorizontal="$xs">
            {wide ? <Stack flex={1} flexBasis={0} /> : null}
            <Text
              flex={1}
              flexBasis={0}
              paddingHorizontal="$lg"
              variant="title"
              color="$colorMuted"
            >
              {comparison.cardTerminal}
            </Text>
            <Text
              flex={1}
              flexBasis={0}
              paddingHorizontal="$lg"
              variant="title"
              color="$accentText"
            >
              {comparison.fazole}
            </Text>
          </Row>
          {comparison.rows.map((row) => (
            <TableRow key={row.label} row={row} />
          ))}
          <Text variant="label" color="$colorMuted" paddingTop="$md">
            {comparison.note}
          </Text>
        </Stack>
      </Reveal>
    </SiteSection>
  );
}
