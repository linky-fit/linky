import { useMedia } from "@linky-fit/ui";
import { copy } from "../copy";
import type { Point } from "../copy";
import { DemoApp } from "../demo/DemoApp";
import type { DemoStart } from "../demo/DemoApp";
import {
  PointList,
  Reveal,
  SectionHeading,
  Showcase,
  SiteSection,
} from "./parts";
import { sectionIds } from "./sectionIds";

/** A feature told beside a live phone that opens on its screen. */
function Feature({
  id,
  feature,
  start,
  phoneLabel,
  phoneFirst = false,
}: {
  id: string;
  feature: {
    eyebrow: string;
    title: string;
    body: string;
    points: readonly Point[];
  };
  start: DemoStart;
  phoneLabel: string;
  phoneFirst?: boolean | undefined;
}) {
  const { wide } = useMedia();
  return (
    <SiteSection id={id}>
      <Reveal>
        <Showcase
          phoneFirst={phoneFirst}
          text={
            <>
              <SectionHeading
                eyebrow={feature.eyebrow}
                title={feature.title}
                body={feature.body}
              />
              <PointList points={feature.points} />
            </>
          }
          phone={
            <DemoApp
              start={start}
              accessibilityLabel={phoneLabel}
              maxWidth={wide ? 320 : 340}
            />
          }
        />
      </Reveal>
    </SiteSection>
  );
}

const labels = copy.demo.labels;

export const TipsFeature = () => (
  <Feature
    id={sectionIds.tips}
    feature={copy.tips}
    start="tips"
    phoneLabel={labels.tips}
    phoneFirst
  />
);

export const HistoryFeature = () => (
  <Feature
    id={sectionIds.history}
    feature={copy.history}
    start="history"
    phoneLabel={labels.history}
  />
);

export const WalletFeature = () => (
  <Feature
    id={sectionIds.wallet}
    feature={copy.wallet}
    start="wallet"
    phoneLabel={labels.wallet}
    phoneFirst
  />
);

export const PrivacyFeature = () => (
  <Feature
    id={sectionIds.privacy}
    feature={copy.privacy}
    start="settings"
    phoneLabel={labels.settings}
  />
);
