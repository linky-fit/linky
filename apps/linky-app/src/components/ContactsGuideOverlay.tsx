import { GuidedTour } from "@linky-fit/ui";
import type { TourTarget } from "@linky-fit/ui";
import React from "react";
import type { I18nKey, Translate } from "../i18n";

interface ContactsGuideOverlayProps {
  currentIdx: number;
  highlightRect: TourTarget | null;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
  stepBodyKey: I18nKey;
  stepTitleKey: I18nKey;
  t: Translate;
  totalSteps: number;
}

export function ContactsGuideOverlay({
  currentIdx,
  highlightRect,
  onBack,
  onNext,
  onSkip,
  stepBodyKey,
  stepTitleKey,
  t,
  totalSteps,
}: ContactsGuideOverlayProps): React.ReactElement {
  const step = currentIdx + 1;
  return (
    <GuidedTour
      title={t(stepTitleKey)}
      description={t(stepBodyKey)}
      step={step}
      total={totalSteps}
      target={highlightRect}
      back={{ label: t("guideBack"), onPress: onBack }}
      next={{
        label: step >= totalSteps ? t("guideDone") : t("guideNext"),
        onPress: onNext,
      }}
      skip={{ label: t("guideSkip"), onPress: onSkip }}
    />
  );
}
