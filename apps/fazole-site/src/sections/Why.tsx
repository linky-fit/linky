import { useCopy } from "../locale";
import { PointGrid, Reveal, SectionHeading, SiteSection } from "./parts";
import { sectionIds } from "./sectionIds";

export function Why() {
  const { why } = useCopy();
  return (
    <SiteSection id={sectionIds.why}>
      <Reveal>
        <SectionHeading title={why.title} />
      </Reveal>
      <Reveal>
        <PointGrid points={why.points} columns={2} />
      </Reveal>
    </SiteSection>
  );
}
