import type { AvatarEditorControlId } from "../derivedProfile";
import { AVATAR_EDITOR_CONTROLS } from "../derivedProfile";
import { AvatarEditorIcon } from "./AvatarEditorIcon";
import type { Translate } from "../i18n";

interface AvatarControlGridCustomChoice {
  isSelected: boolean;
  onPick: () => void;
  pictureUrl: string | null;
}

interface AvatarControlGridProps {
  custom?: AvatarControlGridCustomChoice;
  disabled?: boolean;
  onCycle: (controlId: AvatarEditorControlId) => void;
  t: Translate;
}

export function AvatarControlGrid({
  custom,
  disabled = false,
  onCycle,
  t,
}: AvatarControlGridProps) {
  return (
    <div
      className="onboarding-avatar-grid"
      role="list"
      aria-label={t("onboardingAvatarGridLabel")}
    >
      {AVATAR_EDITOR_CONTROLS.map((control) => (
        <button
          key={control.id}
          type="button"
          className="onboarding-avatar-choice onboarding-avatar-editButton"
          onClick={() => onCycle(control.id)}
          disabled={disabled}
          aria-label={control.label}
          title={control.label}
        >
          <span
            className="onboarding-avatar-choicePlus onboarding-avatar-editEmoji"
            aria-hidden="true"
          >
            <AvatarEditorIcon controlId={control.id} />
          </span>
        </button>
      ))}

      {custom ? (
        <button
          type="button"
          className={`onboarding-avatar-choice onboarding-avatar-choiceCustom${custom.isSelected ? " is-selected" : ""}`}
          onClick={custom.onPick}
          disabled={disabled}
          aria-pressed={custom.isSelected}
        >
          <span className="onboarding-avatar-choicePlus" aria-hidden="true">
            {custom.pictureUrl ? (
              <img
                src={custom.pictureUrl}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            ) : (
              "+"
            )}
          </span>
          <span className="onboarding-avatar-choiceLabel">
            {t("profileUploadPhoto")}
          </span>
        </button>
      ) : null}
    </div>
  );
}
