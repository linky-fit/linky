import { Card, Icon, Pressable, Stack, Text } from "@linky-fit/ui";
import { useId, useState } from "react";
import { copy } from "../copy";
import type { FaqItem } from "../copy";
import { Reveal, SectionHeading, SiteSection } from "./parts";
import { sectionIds } from "./sectionIds";

function Question({ item }: { item: FaqItem }) {
  const [open, setOpen] = useState(false);
  const answerId = useId();
  return (
    <Card padding="$none" gap="$none">
      <Pressable
        aria-expanded={open}
        aria-controls={answerId}
        onPress={() => setOpen(!open)}
        justifyContent="space-between"
        gap="$lg"
        padding="$xl"
        borderRadius="$card"
        hoverStyle={{ backgroundColor: "$neutralSoft" }}
      >
        <Text flex={1} variant="title" color="$colorStrong">
          {item.question}
        </Text>
        <Stack rotate={open ? "180deg" : "0deg"} transition="base">
          <Icon name="ChevronDown" color="$colorMuted" />
        </Stack>
      </Pressable>
      {open ? (
        <Text
          id={answerId}
          color="$colorMuted"
          paddingHorizontal="$xl"
          paddingBottom="$xl"
          transition="base"
          enterStyle={{ opacity: 0, y: -8 }}
        >
          {item.answer}
        </Text>
      ) : null}
    </Card>
  );
}

export function Faq() {
  const { faq } = copy;
  return (
    <SiteSection id={sectionIds.faq}>
      <Reveal>
        <SectionHeading eyebrow={faq.eyebrow} title={faq.title} centered />
      </Reveal>
      <Reveal>
        <Stack
          gap="$sm"
          width="100%"
          maxWidth="$contentWidth"
          alignSelf="center"
        >
          {faq.items.map((item) => (
            <Question key={item.question} item={item} />
          ))}
        </Stack>
      </Reveal>
    </SiteSection>
  );
}
