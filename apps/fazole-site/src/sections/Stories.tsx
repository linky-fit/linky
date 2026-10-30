import { Card, Image, Row, Stack, Text, useMedia } from "@linky-fit/ui";
import type { Story } from "../copy";
import { useCopy } from "../locale";
import { Reveal, SectionHeading, SiteSection } from "./parts";
import { sectionIds } from "./sectionIds";

/** A merchant's photo with what they say about Fazole. */
function StoryCard({ story, wide }: { story: Story; wide: boolean }) {
  return (
    <Card
      flex={wide ? 1 : undefined}
      flexBasis={wide ? 0 : undefined}
      padding="$none"
      gap="$none"
      overflow="hidden"
    >
      <Stack width="100%" aspectRatio={4 / 3} gap="$none">
        <Image
          src={story.image}
          alt={story.alt}
          width="100%"
          height="100%"
          objectFit="cover"
        />
      </Stack>
      <Stack padding="$xl" gap="$sm">
        <Text eyebrow>{story.role}</Text>
        <Text variant="title" color="$colorStrong">
          „{story.quote}“
        </Text>
      </Stack>
    </Card>
  );
}

export function Stories() {
  const { stories } = useCopy();
  const { wide } = useMedia();
  const Columns = wide ? Row : Stack;
  return (
    <SiteSection id={sectionIds.stories}>
      <Reveal>
        <SectionHeading title={stories.title} />
      </Reveal>
      <Reveal>
        <Columns gap="$lg" alignItems="stretch">
          {stories.items.map((story) => (
            <StoryCard key={story.role} story={story} wide={wide} />
          ))}
        </Columns>
      </Reveal>
    </SiteSection>
  );
}
