import React from "react";
import type { I18nKey, Translate } from "../i18n";

interface ContactsGuideOverlayProps {
  currentIdx: number;
  highlightRect: {
    height: number;
    left: number;
    top: number;
    width: number;
  } | null;
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
  const moveGuideTop =
    highlightRect?.top != null &&
    typeof window !== "undefined" &&
    highlightRect.top > window.innerHeight * 0.55;

  return (
    <div className="guide-overlay" aria-live="polite">
      {highlightRect ? (
        <div
          className="guide-highlight"
          aria-hidden="true"
          style={{
            top: highlightRect.top,
            left: highlightRect.left,
            width: highlightRect.width,
            height: highlightRect.height,
          }}
        />
      ) : null}

      <div
        className="guide-card"
        role="dialog"
        aria-modal="false"
        style={moveGuideTop ? { top: 64, bottom: "auto" } : undefined}
      >
        <div className="guide-step">
          {currentIdx + 1} / {totalSteps}
        </div>
        <div className="guide-title">{t(stepTitleKey)}</div>
        <div className="guide-body">{t(stepBodyKey)}</div>
        <div className="guide-actions">
          <button
            type="button"
            className="guide-btn secondary"
            onClick={onSkip}
          >
            {t("guideSkip")}
          </button>
          <button
            type="button"
            className="guide-btn secondary"
            onClick={onBack}
            disabled={currentIdx === 0}
          >
            {t("guideBack")}
          </button>
          <button type="button" className="guide-btn primary" onClick={onNext}>
            {currentIdx + 1 >= totalSteps ? t("guideDone") : t("guideNext")}
          </button>
        </div>
      </div>
    </div>
  );
}
