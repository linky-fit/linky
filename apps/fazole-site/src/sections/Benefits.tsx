import { copy } from "../copy";
import { PointGrid, Reveal, SectionHeading, SiteSection } from "./parts";
import { sectionIds } from "./sectionIds";

export function Benefits() {
  const { benefits } = copy;
  return (
    <SiteSection id={sectionIds.benefits}>
      <Reveal>
        <SectionHeading
          eyebrow={benefits.eyebrow}
          title={benefits.title}
          body={benefits.body}
        />
      </Reveal>
      <Reveal>
        <PointGrid points={benefits.points} columns={3} />
      </Reveal>
    </SiteSection>
  );
}

export function Audience() {
  const { audience } = copy;
  return (
    <SiteSection id={sectionIds.audience}>
      <Reveal>
        <SectionHeading
          eyebrow={audience.eyebrow}
          title={audience.title}
          body={audience.body}
        />
      </Reveal>
      <Reveal>
        <PointGrid points={audience.points} columns={4} />
      </Reveal>
    </SiteSection>
  );
}
